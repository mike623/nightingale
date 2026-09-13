use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::net::{Shutdown, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{LazyLock, Mutex, MutexGuard};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tracing::{info, warn};
use ts_rs::TS;

use crate::cache::{CacheDir, models_dir};
use crate::config::AppConfig;
use crate::error::NightingaleError;
use crate::library_db;
use crate::library_model::LibraryMenuFilters;
use crate::lyrics::{fetch_lrclib_lyrics, write_lyrics_file};
use crate::song::{Song, SongOrigin, TranscriptSource, compute_file_hash, read_transcript_meta};
use crate::source::active_source;

// ─── Analysis queue (persisted to disk) ──────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum QueuedStatus {
    Queued,
    Analyzing(usize),
    Failed(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, TS)]
#[ts(export)]
pub struct AnalysisQueue {
    pub entries: HashMap<String, QueuedStatus>,
}

impl AnalysisQueue {
    pub fn load() -> Self {
        let entries = library_db::analysis_queue_load_rows()
            .map(|rows| {
                rows.into_iter()
                    .map(|(h, st, pct, msg)| {
                        let status = match st.as_str() {
                            "queued" => QueuedStatus::Queued,
                            "analyzing" => QueuedStatus::Analyzing(pct.unwrap_or(0) as usize),
                            "failed" => QueuedStatus::Failed(msg.unwrap_or_default()),
                            _ => QueuedStatus::Queued,
                        };
                        (h, status)
                    })
                    .collect()
            })
            .unwrap_or_default();
        Self { entries }
    }

    pub fn save(&self) {
        let rows: Vec<_> = self
            .entries
            .iter()
            .map(|(k, v)| match v {
                QueuedStatus::Queued => (k.clone(), "queued".to_string(), None, None),
                QueuedStatus::Analyzing(p) => {
                    (k.clone(), "analyzing".to_string(), Some(*p as i64), None)
                }
                QueuedStatus::Failed(s) => (k.clone(), "failed".to_string(), None, Some(s.clone())),
            })
            .collect();
        let _ = library_db::analysis_queue_save_rows(&rows);
    }

    pub fn clear() {
        let _ = library_db::analysis_queue_clear();
    }
}
use crate::vendor::{analyzer_dir, ffmpeg_path, python_path, silent_command};

// ─── Server process ──────────────────────────────────────────────────

/// Pids of the live analyzer server processes, one per worker slot.
static SERVER_PIDS: LazyLock<Mutex<Vec<u32>>> = LazyLock::new(|| Mutex::new(Vec::new()));

fn forget_server_pid(pid: u32) {
    SERVER_PIDS.lock().unwrap().retain(|p| *p != pid);
}

const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(60);

/// Songs analyzed in parallel, each on its own analyzer server process. Two is
/// the ceiling — a third server is more GPU memory than a consumer card has.
const MAX_ANALYSIS_WORKERS: usize = 2;

struct ServerProcess {
    child: Child,
    reader: BufReader<TcpStream>,
    writer: BufWriter<TcpStream>,
}

impl Drop for ServerProcess {
    fn drop(&mut self) {
        let pid = self.child.id();
        info!("[analyzer] Killing server process (pid={pid})");
        forget_server_pid(pid);
        if let Ok(stream) = self.writer.get_ref().try_clone() {
            let _ = stream.shutdown(Shutdown::Both);
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// One independent server process per worker slot. The protocol is a
/// single-connection request/response pipe, so concurrency means more servers,
/// not more requests down one socket.
static ANALYZER_SERVERS: LazyLock<Vec<Mutex<Option<ServerProcess>>>> =
    LazyLock::new(|| (0..MAX_ANALYSIS_WORKERS).map(|_| Mutex::new(None)).collect());

/// Grab whichever server slot is free, falling back to waiting on the first.
/// Used by off-queue passes that just need *a* server.
fn lock_any_server() -> MutexGuard<'static, Option<ServerProcess>> {
    for slot in ANALYZER_SERVERS.iter() {
        if let Ok(guard) = slot.try_lock() {
            return guard;
        }
    }
    ANALYZER_SERVERS[0].lock().unwrap()
}

#[derive(Debug, Deserialize)]
struct ReadyHandshake {
    port: u16,
    token: String,
    #[serde(default)]
    device: Option<String>,
}

fn drain_lines_to_log<R: BufRead + Send + 'static>(mut reader: R, label: &'static str) {
    std::thread::spawn(move || {
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => return,
                Ok(_) => {
                    let trimmed = line.trim_end();
                    if !trimmed.is_empty() {
                        info!("[analyzer {label}] {trimmed}");
                    }
                }
            }
        }
    });
}

fn read_ready_handshake<R: BufRead>(reader: &mut R) -> Result<ReadyHandshake, NightingaleError> {
    let mut line = String::new();
    loop {
        line.clear();
        let bytes = reader.read_line(&mut line)?;
        if bytes == 0 {
            return Err(NightingaleError::Other(
                "Analyzer server exited before handshake".into(),
            ));
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<serde_json::Value>(trimmed) {
            Ok(value) if value.get("event").and_then(|v| v.as_str()) == Some("ready") => {
                return serde_json::from_value::<ReadyHandshake>(value).map_err(|e| {
                    NightingaleError::Other(format!("Malformed ready handshake: {e}"))
                });
            }
            _ => {
                info!("[analyzer stdout] {trimmed}");
            }
        }
    }
}

fn connect_and_authenticate(
    port: u16,
    token: &str,
) -> Result<(BufReader<TcpStream>, BufWriter<TcpStream>), NightingaleError> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let stream = TcpStream::connect_timeout(&addr, HANDSHAKE_TIMEOUT).map_err(|e| {
        NightingaleError::Other(format!("Failed to connect to analyzer server: {e}"))
    })?;
    stream.set_nodelay(true).ok();
    stream.set_read_timeout(Some(HANDSHAKE_TIMEOUT))?;
    stream.set_write_timeout(Some(HANDSHAKE_TIMEOUT))?;

    let writer_stream = stream
        .try_clone()
        .map_err(|e| NightingaleError::Other(format!("Failed to clone analyzer socket: {e}")))?;
    let mut reader = BufReader::new(stream);
    let mut writer = BufWriter::new(writer_stream);

    let hello = serde_json::json!({"type": "hello", "token": token});
    writer.write_all(serde_json::to_string(&hello).unwrap().as_bytes())?;
    writer.write_all(b"\n")?;
    writer.flush()?;

    let mut line = String::new();
    let bytes = reader.read_line(&mut line)?;
    if bytes == 0 {
        return Err(NightingaleError::Other(
            "Analyzer server closed connection during handshake".into(),
        ));
    }
    let value: serde_json::Value = serde_json::from_str(line.trim())?;
    if value.get("type").and_then(|v| v.as_str()) != Some("hello_ack") {
        return Err(NightingaleError::Other(format!(
            "Analyzer auth failed: {}",
            line.trim()
        )));
    }

    reader.get_ref().set_read_timeout(None)?;
    reader.get_ref().set_write_timeout(None)?;

    Ok((reader, writer))
}

fn spawn_server() -> Result<ServerProcess, NightingaleError> {
    let python = python_path();
    let script = analyzer_dir().join("server.py");
    let models = models_dir();
    let ffmpeg = ffmpeg_path();
    let ffmpeg_dir = ffmpeg.parent().unwrap_or(std::path::Path::new("."));
    let path_env = if let Some(existing) = std::env::var_os("PATH") {
        let mut paths = std::env::split_paths(&existing).collect::<Vec<_>>();
        paths.insert(0, ffmpeg_dir.to_path_buf());
        std::env::join_paths(paths).unwrap_or(existing)
    } else {
        ffmpeg_dir.as_os_str().to_os_string()
    };

    let mut cmd = silent_command(&python);
    cmd.env("PATH", &path_env)
        .env("TORCH_HOME", models.join("torch"))
        .env("HF_HOME", models.join("huggingface"))
        .env("FFMPEG_PATH", &ffmpeg)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONWARNINGS", "ignore")
        .env("PYTORCH_ENABLE_MPS_FALLBACK", "1")
        .env("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
        .env("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
        .env("NLTK_DATA", models.join("nltk_data"))
        .env("NEMO_CACHE_DIR", models.join("nemo"))
        .env("ONNX_ASR_CACHE_DIR", models.join("onnx_asr"))
        .arg(&script)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| NightingaleError::Other(format!("Failed to start analyzer server: {e}")))?;
    let pid = child.id();
    SERVER_PIDS.lock().unwrap().push(pid);
    info!("[analyzer] Server process spawned (pid={pid})");

    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            forget_server_pid(pid);
            return Err(NightingaleError::Other(
                "Failed to capture server stdout".into(),
            ));
        }
    };
    let mut stdout_reader = BufReader::new(stdout);

    let handshake = match read_ready_handshake(&mut stdout_reader) {
        Ok(h) => h,
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            forget_server_pid(pid);
            return Err(e);
        }
    };
    if let Some(device) = handshake.device.as_deref() {
        info!(
            "[analyzer] Handshake ok: device={device} port={}",
            handshake.port
        );
    } else {
        info!("[analyzer] Handshake ok: port={}", handshake.port);
    }

    let (reader, writer) = match connect_and_authenticate(handshake.port, &handshake.token) {
        Ok(pair) => pair,
        Err(e) => {
            let _ = child.kill();
            let _ = child.wait();
            forget_server_pid(pid);
            return Err(e);
        }
    };

    drain_lines_to_log(stdout_reader, "stdout");
    if let Some(stderr) = child.stderr.take() {
        drain_lines_to_log(BufReader::new(stderr), "stderr");
    }

    Ok(ServerProcess {
        child,
        reader,
        writer,
    })
}

fn ensure_server(
    guard: &mut std::sync::MutexGuard<Option<ServerProcess>>,
) -> Result<(), NightingaleError> {
    if guard.is_some() {
        return Ok(());
    }
    let server = spawn_server()?;
    **guard = Some(server);
    Ok(())
}

// ─── Queue state ─────────────────────────────────────────────────────

struct AnalyzerState {
    queue: VecDeque<String>,
    /// Hashes a worker is analyzing right now.
    active: HashSet<String>,
    /// Server slots held by running workers; also the live worker count.
    busy_slots: HashSet<usize>,
}

static ANALYZER: LazyLock<Mutex<AnalyzerState>> = LazyLock::new(|| {
    Mutex::new(AnalyzerState {
        queue: VecDeque::new(),
        active: HashSet::new(),
        busy_slots: HashSet::new(),
    })
});

static FORCE_TRANSCRIBE: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

/// Hashes whose queued job should only run stem separation (key detect +
/// separation) and keep the already-written LRC-provided transcript.
static STEMS_ONLY: LazyLock<Mutex<HashSet<String>>> =
    LazyLock::new(|| Mutex::new(HashSet::new()));

/// Mark a hash so its next analysis pass separates stems without transcribing,
/// preserving the transcript built from provided LRC.
pub fn mark_stems_only(file_hash: &str) {
    STEMS_ONLY.lock().unwrap().insert(file_hash.to_string());
}

// ─── Helpers ─────────────────────────────────────────────────────────

fn update_queue_status(file_hash: &str, status: QueuedStatus) {
    let (st, pct, msg) = match &status {
        QueuedStatus::Queued => ("queued", None, None::<String>),
        QueuedStatus::Analyzing(p) => ("analyzing", Some(*p as i64), None::<String>),
        QueuedStatus::Failed(s) => ("failed", None, Some(s.clone())),
    };
    let _ = library_db::analysis_queue_upsert_row(file_hash, st, pct, msg.as_deref());
}

fn remove_from_queue(file_hash: &str) {
    let _ = library_db::analysis_queue_delete(file_hash);
}

pub(crate) fn update_song_analyzed(
    file_hash: &str,
    is_analyzed: bool,
    language: Option<String>,
    transcript_source: Option<TranscriptSource>,
    key: Option<String>,
    tempo: Option<f64>,
) {
    let Some(mut song) = library_db::load_song_by_hash(file_hash).ok().flatten() else {
        return;
    };
    song.is_analyzed = is_analyzed;
    song.language = language;
    song.transcript_source = transcript_source;
    if is_analyzed {
        song.key = key;
        if let Some(value) = tempo {
            song.tempo = value;
        }
        // LRC-provided songs without stem separation are flagged in the
        // transcript; mirror that onto the song so playback hides the guide.
        song.no_stems = read_transcript_meta(&CacheDir::new(), file_hash).no_stems;
    } else {
        song.key = None;
        song.override_key = None;
        song.tempo = 1.0;
        song.key_offset = 0;
        song.no_stems = false;
    }
    let _ = library_db::update_song_fields(file_hash, &song);
}

/// Server slots to start new workers on: enough that every queued song has a
/// worker, capped by the configured worker count and the size of the pool.
fn slots_to_spawn(busy: &HashSet<usize>, queued: usize, configured: usize) -> Vec<usize> {
    let wanted = configured
        .min(MAX_ANALYSIS_WORKERS)
        .min(busy.len() + queued);
    let mut taken = busy.clone();
    let mut spawn = Vec::new();
    while taken.len() < wanted {
        let Some(slot) = (0..MAX_ANALYSIS_WORKERS).find(|s| !taken.contains(s)) else {
            break;
        };
        taken.insert(slot);
        spawn.push(slot);
    }
    spawn
}

/// Spawn workers until every queued song has one. Workers retire themselves
/// (releasing their slot) once the queue drains.
fn ensure_workers(state: &mut AnalyzerState) {
    let configured = AppConfig::load().analysis_workers();
    for slot in slots_to_spawn(&state.busy_slots, state.queue.len(), configured) {
        state.busy_slots.insert(slot);
        spawn_worker(slot);
    }
}

// ─── Public API ──────────────────────────────────────────────────────

pub(crate) fn is_usdx_song(file_hash: &str) -> bool {
    library_db::load_song_by_hash(file_hash)
        .ok()
        .flatten()
        .map(|s| s.usdx.is_some())
        .unwrap_or(false)
}

pub fn enqueue_one(file_hash: &str) {
    if is_usdx_song(file_hash) {
        return;
    }
    let mut state = ANALYZER.lock().unwrap();
    if state.active.contains(file_hash) {
        return;
    }
    if !state.queue.iter().any(|h| h == file_hash) {
        state.queue.push_back(file_hash.to_string());
        update_queue_status(file_hash, QueuedStatus::Queued);
    }
    ensure_workers(&mut state);
}

pub fn enqueue_all(filters: &LibraryMenuFilters) {
    let queue = AnalysisQueue::load();
    let mut state = ANALYZER.lock().unwrap();

    let pending_hashes =
        library_db::iter_file_hashes_filtered_not_analyzed(filters).unwrap_or_default();

    let mut newly_queued = Vec::new();
    for file_hash in pending_hashes {
        if !queue.entries.contains_key(&file_hash)
            && !state.active.contains(&file_hash)
            && !state.queue.iter().any(|h| h == &file_hash)
        {
            state.queue.push_back(file_hash.clone());
            newly_queued.push(file_hash);
        }
    }
    drop(state);

    // Write the queued rows before any worker starts, so a worker's
    // "analyzing" status can't be clobbered by a late "queued" upsert.
    for hash in &newly_queued {
        let _ = library_db::analysis_queue_upsert_row(hash, "queued", None, None);
    }

    ensure_workers(&mut ANALYZER.lock().unwrap());
}

pub fn shutdown_server() {
    let pids: Vec<u32> = std::mem::take(&mut *SERVER_PIDS.lock().unwrap());
    if pids.is_empty() {
        return;
    }
    info!("[analyzer] Graceful shutdown of servers (pids={pids:?})");
    for slot in ANALYZER_SERVERS.iter() {
        if let Ok(mut guard) = slot.try_lock()
            && let Some(server) = guard.as_mut()
        {
            let _ = server.writer.write_all(b"{\"type\":\"quit\"}\n");
            let _ = server.writer.flush();
        }
    }
    std::thread::spawn(move || {
        for pid in &pids {
            let _ = Command::new("kill").args([&pid.to_string()]).status();
        }
        std::thread::sleep(std::time::Duration::from_secs(3));
        for pid in &pids {
            let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
        }
    });
}

pub fn delete_cache(file_hash: &str) {
    if is_usdx_song(file_hash) {
        return;
    }
    let cache = CacheDir::new();
    cache.delete_song_cache(file_hash);
    update_song_analyzed(file_hash, false, None, None, None, None);
}

/// Remove a song from the library entirely: its source file, every generated
/// file keyed by its hash, and its library + queue rows.
///
/// Local-file songs only. A remote-origin song lives on someone else's
/// server, so there is nothing here for us to delete and the caller should
/// not be offering the action in the first place.
pub fn delete_song(file_hash: &str) -> Result<(), String> {
    let song = library_db::load_song_by_hash(file_hash)
        .map_err(|e| format!("failed loading song: {e}"))?
        .ok_or_else(|| "song is no longer in the library".to_string())?;

    if !matches!(song.origin, SongOrigin::LocalFile) {
        return Err("only songs from a local folder library can be deleted".to_string());
    }

    // Cache and rows go first: if the file delete fails (permissions, read-only
    // volume) we'd rather leave an orphaned file the next scan re-adds than a
    // library row pointing at media the user believes is gone.
    CacheDir::new().delete_song_cache(file_hash);
    library_db::delete_song_by_hash(file_hash)
        .map_err(|e| format!("failed updating library: {e}"))?;

    match std::fs::remove_file(&song.path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("failed deleting {}: {e}", song.path.display())),
    }
}

pub fn reanalyze_transcript(file_hash: &str, language: Option<String>) {
    if is_usdx_song(file_hash) {
        return;
    }

    if let Some(lang) = language {
        if !lang.is_empty() {
            let mut config = AppConfig::load();
            config.set_language_override(file_hash.to_string(), lang);
            config.save();
        }
    }
    reanalyze(file_hash, false);
}

pub fn reanalyze_full(file_hash: &str) {
    if is_usdx_song(file_hash) {
        return;
    }

    reanalyze(file_hash, true);
}

pub fn realign(file_hash: &str, language: Option<String>) {
    if is_usdx_song(file_hash) {
        return;
    }

    if let Some(lang) = language.as_ref().filter(|lang| !lang.is_empty()) {
        let mut config = AppConfig::load();
        config.set_language_override(file_hash.to_string(), lang.clone());
        config.save();
    }

    let cache = CacheDir::new();
    let previous_language = library_db::load_song_by_hash(file_hash)
        .ok()
        .flatten()
        .and_then(|song| song.language);
    materialize_lyrics_from_transcript(&cache, file_hash);
    let _ = std::fs::remove_file(cache.transcript_path(file_hash));
    cache.delete_transcript_variants(file_hash);
    update_song_analyzed(
        file_hash,
        false,
        language.or(previous_language),
        None,
        None,
        None,
    );
    enqueue_one(file_hash);
}

pub fn reanalyze_force_transcribe(file_hash: &str) {
    if is_usdx_song(file_hash) {
        return;
    }

    FORCE_TRANSCRIBE
        .lock()
        .unwrap()
        .insert(file_hash.to_string());

    reanalyze(file_hash, false);
}

fn reanalyze(file_hash: &str, full: bool) {
    let cache = CacheDir::new();
    if full {
        cache.delete_song_cache(file_hash);
    } else {
        let _ = std::fs::remove_file(cache.transcript_path(file_hash));
        cache.delete_transcript_variants(file_hash);
        let _ = std::fs::remove_file(cache.lyrics_path(file_hash));
    }
    update_song_analyzed(file_hash, false, None, None, None, None);
    enqueue_one(file_hash);
}

fn materialize_lyrics_from_transcript(cache: &CacheDir, file_hash: &str) {
    if cache.lyrics_path(file_hash).is_file() {
        return;
    }

    let transcript_path = cache.transcript_path(file_hash);
    let Ok(data) = std::fs::read_to_string(&transcript_path) else {
        return;
    };

    #[derive(Deserialize)]
    struct Segment {
        #[serde(default)]
        text: String,
    }

    #[derive(Deserialize)]
    struct TranscriptShape {
        #[serde(default)]
        segments: Vec<Segment>,
    }

    let Ok(parsed) = serde_json::from_str::<TranscriptShape>(&data) else {
        return;
    };

    let lines: Vec<String> = parsed
        .segments
        .into_iter()
        .map(|s| s.text.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    if lines.is_empty() {
        return;
    }

    if let Err(e) = write_lyrics_file(cache, file_hash, &lines) {
        warn!("[analyzer] Failed to materialize lyrics from transcript for {file_hash}: {e}");
    }
}

// ─── Worker ──────────────────────────────────────────────────────────

fn spawn_worker(slot: usize) {
    std::thread::spawn(move || {
        let cache = CacheDir::new();

        loop {
            let file_hash = {
                let mut state = ANALYZER.lock().unwrap();
                match state.queue.pop_front() {
                    Some(hash) => {
                        state.active.insert(hash.clone());
                        hash
                    }
                    None => {
                        state.busy_slots.remove(&slot);
                        return;
                    }
                }
            };

            process_song(&file_hash, &cache, slot);

            let mut state = ANALYZER.lock().unwrap();
            state.active.remove(&file_hash);
        }
    });
}

fn process_song(initial_hash: &str, cache: &CacheDir, slot: usize) {
    let Some(song) = library_db::load_song_by_hash(initial_hash).ok().flatten() else {
        warn!("[analyzer] Song with hash {initial_hash} not found in store, skipping");
        return;
    };

    // Default lyrics path (see docs/adr/0003): no WhisperX, and — unless lyric
    // lookup is opted into — no LRCLIB lookup either, so analysis is just stem
    // separation + key. When word-level is off and this isn't a forced /
    // already-stems-only pass:
    //   - lookup off (default)       -> separate stems, no lyrics at all.
    //   - lookup on, synced match    -> line-level LRC + stem separation.
    //   - lookup on, no synced match -> separate stems, NO transcription.
    // WhisperX runs only when word-level is enabled globally or forced per-song.
    let prefs = AppConfig::load();
    if !prefs.word_level_lyrics()
        && !STEMS_ONLY.lock().unwrap().contains(initial_hash)
        && !FORCE_TRANSCRIBE.lock().unwrap().contains(initial_hash)
    {
        if !prefs.lyrics_lookup() {
            info!(
                "[analyzer] Lyric lookup off for {}; separating stems only",
                song.file_hash
            );
        } else if let Some(lrc) = crate::lyrics::best_synced_lrc(&song) {
            match crate::lyrics::provide_lrc(&song.file_hash, &lrc, true) {
                Ok(()) => {
                    info!(
                        "[analyzer] Using LRCLIB line-level lyrics for {} (skipping WhisperX)",
                        song.file_hash
                    );
                    return;
                }
                Err(e) => {
                    warn!("[analyzer] LRC path failed ({e}); separating stems without lyrics")
                }
            }
        } else {
            info!(
                "[analyzer] No LRCLIB synced lyrics for {}; separating stems without lyrics \
                 (enable word-level timing or search LRCLIB manually to get lyrics)",
                song.file_hash
            );
        }
        // Lyric-less: run the stems-only pass (separation + key), no WhisperX.
        mark_stems_only(&song.file_hash);
    }

    let (song, local_path, file_hash_owned) = match prepare_audio_for_analysis(&song, cache) {
        Ok(out) => out,
        Err(e) => {
            warn!("[analyzer] Failed to prepare audio for analysis: {e}");
            update_queue_status(
                initial_hash,
                QueuedStatus::Failed(format!("audio prep failed: {e}")),
            );
            return;
        }
    };
    let file_hash = file_hash_owned.as_str();

    info!(
        "[analyzer] Starting analysis: {} (hash={})",
        local_path.display(),
        file_hash
    );

    update_queue_status(file_hash, QueuedStatus::Analyzing(0));

    // Stems-only: keep the LRC-provided transcript and just separate stems.
    // The intent may have been keyed by the pre-rekey hash for remote songs.
    let stems_only = {
        let mut set = STEMS_ONLY.lock().unwrap();
        set.remove(file_hash) || set.remove(initial_hash)
    };
    if stems_only && file_hash != initial_hash {
        // Move the pre-written transcript to the rekeyed hash so the pass can
        // patch it in place.
        let _ = std::fs::rename(
            cache.transcript_path(initial_hash),
            cache.transcript_path(file_hash),
        );
    }

    let config = AppConfig::load();
    let skip_lrclib = stems_only || FORCE_TRANSCRIBE.lock().unwrap().remove(file_hash);
    let lyrics_path = if skip_lrclib {
        None
    } else {
        fetch_lrclib_lyrics(&song, cache)
    };

    let mut cmd_json = serde_json::json!({
        "type": "analyze",
        "audio_path": local_path.to_string_lossy(),
        "cache_path": cache.path.to_string_lossy(),
        "hash": file_hash,
        "model": config.whisper_model(),
        "beam_size": config.beam_size(),
        "batch_size": config.batch_size(),
        "separator": config.separator(),
        "engine": config.asr_engine(),
        "align_backend": config.align_backend(),
        "vocal_detection_threshold_pct": config.vocal_detection_threshold_pct(),
    });

    if stems_only {
        cmd_json["skip_transcription"] = serde_json::json!(true);
    }

    if let Some(ref lp) = lyrics_path {
        cmd_json["lyrics"] = serde_json::json!(lp.to_string_lossy());
    }
    let language_hint = config
        .language_override(file_hash)
        .map(str::to_string)
        .or_else(|| lyrics_path.as_ref().and_then(|_| song.language.clone()))
        .filter(|lang| {
            // "unknown"/empty is not a real language: passing it as a forced
            // alignment language crashes whisperx, so let the worker detect it.
            let normalized = lang.trim().to_ascii_lowercase();
            !normalized.is_empty() && normalized != "unknown" && normalized != "und"
        });
    if let Some(lang) = language_hint {
        cmd_json["language"] = serde_json::json!(lang);
    }

    let json_str = serde_json::to_string(&cmd_json).unwrap();
    let mut retried = false;

    loop {
        let mut guard = ANALYZER_SERVERS[slot].lock().unwrap();

        if let Err(e) = ensure_server(&mut guard) {
            warn!("[analyzer] Failed to start server: {e}");
            update_queue_status(file_hash, QueuedStatus::Failed(e.to_string()));
            return;
        }

        let server = guard.as_mut().unwrap();
        match send_and_monitor(server, &json_str, Some(file_hash)) {
            Ok(SongResult::Done) => {
                finalize_song(file_hash, cache);
                return;
            }
            Ok(SongResult::Oom) => {
                warn!("[analyzer] CUDA OOM, killing server to free GPU memory");
                *guard = None;

                if !retried {
                    retried = true;
                    info!("[analyzer] Respawning server and retrying with clean GPU");
                    update_queue_status(file_hash, QueuedStatus::Analyzing(0));
                    continue;
                }
                update_queue_status(file_hash, QueuedStatus::Failed("CUDA out of memory".into()));
                return;
            }
            Ok(SongResult::Error(msg)) => {
                update_queue_status(file_hash, QueuedStatus::Failed(msg));
                return;
            }
            Err(e) => {
                warn!("[analyzer] Server crashed: {e}");
                *guard = None;

                if !retried {
                    retried = true;
                    info!("[analyzer] Respawning server and retrying");
                    update_queue_status(file_hash, QueuedStatus::Analyzing(0));
                    continue;
                }
                update_queue_status(
                    file_hash,
                    QueuedStatus::Failed(format!("Server crashed: {e}")),
                );
                return;
            }
        }
    }
}

fn finalize_song(file_hash: &str, cache: &CacheDir) {
    if cache.transcript_exists(file_hash) {
        if let Err(err) = crate::playback::ensure_playable_source_video(file_hash) {
            warn!("[analyzer] Playable source-video conversion failed for {file_hash}: {err}");
        }
        let meta = read_transcript_meta(cache, file_hash);
        remove_from_queue(file_hash);
        update_song_analyzed(
            file_hash,
            true,
            meta.language,
            Some(meta.source),
            meta.key,
            Some(meta.tempo),
        );
        info!("[analyzer] Analysis complete for {file_hash}");
    } else {
        update_queue_status(
            file_hash,
            QueuedStatus::Failed("Transcript file not found after analysis".into()),
        );
    }
}

// ─── LRC (play-original) preparation ─────────────────────────────────

/// Prepare an LRC-provided song that plays over its original mix, without
/// routing it through the analysis status queue.
///
/// The analyzer-free work runs synchronously so the song is immediately
/// playable: materialize the audio, rekey remote rows to the content hash, and
/// mark the song ready (source=Lrc, no_stems). None of this touches the
/// analyzer server, so it never stalls behind a running analysis.
///
/// The musical key is then detected on a background thread (which contends on
/// the analyzer server) and patched in once it lands, so the key/tempo controls
/// unlock later without blocking playback.
pub fn prepare_lrc_no_stems(file_hash: &str) -> Result<(), NightingaleError> {
    let cache = CacheDir::new();
    let Some(song) = library_db::load_song_by_hash(file_hash).ok().flatten() else {
        return Err(NightingaleError::Other("Song not found".into()));
    };

    // Materialize the audio and, for remote sources, rekey the row to the
    // content hash so all downstream cache files follow the usual layout.
    let (mut song, local_path, real_hash) = prepare_audio_for_analysis(&song, &cache)?;
    let real_hash = real_hash.to_string();

    // A rekey moves the row — carry the transcript we wrote under the original
    // hash across so the key pass can patch it in place.
    if real_hash != file_hash {
        let _ = std::fs::rename(
            cache.transcript_path(file_hash),
            cache.transcript_path(&real_hash),
        );
    }

    // Mark ready right away (key still unknown) so playback over the original
    // mix is available immediately, before the key detection runs.
    song.is_analyzed = true;
    song.transcript_source = Some(TranscriptSource::Lrc);
    song.key = None;
    song.override_key = None;
    song.tempo = 1.0;
    song.key_offset = 0;
    song.no_stems = true;
    library_db::update_song_fields(&real_hash, &song)
        .map_err(|e| NightingaleError::Other(e.to_string()))?;
    let _ = crate::playback::ensure_playable_source_video(&real_hash);

    // Detect the key off-queue in the background; patch it onto the row once it
    // lands so the key/tempo shift controls unlock without blocking playback.
    std::thread::spawn(move || {
        let cache = CacheDir::new();
        if let Err(e) = run_key_pass(&cache, &local_path, &real_hash) {
            warn!("[analyzer] LRC key detection failed for {real_hash}: {e}");
            return;
        }
        let meta = read_transcript_meta(&cache, &real_hash);
        if let Some(mut updated) = library_db::load_song_by_hash(&real_hash).ok().flatten() {
            updated.key = meta.key;
            let _ = library_db::update_song_fields(&real_hash, &updated);
        }
        info!("[analyzer] LRC key detection complete for {real_hash}");
    });
    Ok(())
}

/// Run a key-only analysis pass (no transcription, no stem separation) against
/// the running analyzer server, keeping it off the status queue. On success the
/// detected key is patched into the existing transcript by the pipeline.
fn run_key_pass(
    cache: &CacheDir,
    local_path: &Path,
    file_hash: &str,
) -> Result<(), NightingaleError> {
    let config = AppConfig::load();
    let cmd_json = serde_json::json!({
        "type": "analyze",
        "audio_path": local_path.to_string_lossy(),
        "cache_path": cache.path.to_string_lossy(),
        "hash": file_hash,
        "model": config.whisper_model(),
        "beam_size": config.beam_size(),
        "batch_size": config.batch_size(),
        "separator": config.separator(),
        "engine": config.asr_engine(),
        "align_backend": config.align_backend(),
        "vocal_detection_threshold_pct": config.vocal_detection_threshold_pct(),
        // Key only: keep the provided LRC transcript and the original mix.
        "skip_transcription": true,
        "skip_separation": true,
    });
    let json_str = serde_json::to_string(&cmd_json).unwrap();

    let mut retried = false;
    loop {
        let mut guard = lock_any_server();
        ensure_server(&mut guard)?;
        let server = guard.as_mut().unwrap();
        // `None` progress hash keeps this off the status pipe (no queue rows).
        match send_and_monitor(server, &json_str, None) {
            Ok(SongResult::Done) => return Ok(()),
            Ok(SongResult::Oom) | Err(_) => {
                *guard = None;
                if !retried {
                    retried = true;
                    continue;
                }
                return Err(NightingaleError::Other("key detection failed".into()));
            }
            Ok(SongResult::Error(msg)) => {
                return Err(NightingaleError::Other(msg));
            }
        }
    }
}

// ─── Audio materialization for non-local sources ─────────────────────

/// Make sure the song's audio is present on disk and the row is keyed by the
/// true Blake3 hash before analysis kicks off. For `LocalFile` songs this is a
/// no-op. For Jellyfin songs we download once into `cache/sources/<hash>.<ext>`
/// then rekey the DB row + analysis queue from the placeholder id-hash to the
/// content hash so all downstream cache files (`<hash>_instrumental.mp3` etc.)
/// follow the existing convention.
fn prepare_audio_for_analysis(
    song: &Song,
    cache: &CacheDir,
) -> Result<(Song, PathBuf, String), NightingaleError> {
    match &song.origin {
        SongOrigin::LocalFile => Ok((song.clone(), song.path.clone(), song.file_hash.clone())),
        // Both remote origins go through the active source's
        // `ensure_local_media` and then get rekeyed to the true Blake3 hash.
        SongOrigin::Jellyfin { .. } | SongOrigin::Navidrome { .. } | SongOrigin::Plex { .. } => {
            let source = active_source()?
                .ok_or_else(|| NightingaleError::Other("no active library source".into()))?;
            let downloaded_path = source.ensure_local_media(song, cache)?;

            let real_hash = compute_file_hash(&downloaded_path)?;
            if real_hash == song.file_hash {
                return Ok((song.clone(), downloaded_path, song.file_hash.clone()));
            }

            let ext = downloaded_path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("bin");
            let new_source_path = cache
                .path
                .join("sources")
                .join(format!("{real_hash}.{ext}"));

            if new_source_path != downloaded_path {
                if let Some(parent) = new_source_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                if new_source_path.is_file() {
                    let _ = std::fs::remove_file(&downloaded_path);
                } else {
                    std::fs::rename(&downloaded_path, &new_source_path)?;
                }
            }

            let mut updated = song.clone();
            updated.file_hash = real_hash.clone();
            updated.path = new_source_path.clone();

            library_db::rekey_song(&song.file_hash, &real_hash, &updated).map_err(|e| {
                NightingaleError::Other(format!("failed to rekey remote song: {e}"))
            })?;

            Ok((updated, new_source_path, real_hash))
        }
    }
}

// ─── Server communication ────────────────────────────────────────────

enum SongResult {
    Done,
    Oom,
    Error(String),
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ServerEvent {
    Progress {
        pct: u32,
        #[serde(default)]
        msg: String,
    },
    Done,
    Error {
        #[serde(default)]
        kind: Option<String>,
        #[serde(default)]
        msg: String,
    },
    #[serde(other)]
    Unknown,
}

fn send_and_monitor(
    server: &mut ServerProcess,
    json_cmd: &str,
    progress_hash: Option<&str>,
) -> Result<SongResult, NightingaleError> {
    server.writer.write_all(json_cmd.as_bytes())?;
    server.writer.write_all(b"\n")?;
    server.writer.flush()?;

    let mut line_buf = String::new();
    loop {
        line_buf.clear();
        let bytes = server.reader.read_line(&mut line_buf)?;

        if bytes == 0 {
            return Err("Server closed connection unexpectedly".into());
        }

        let line = line_buf.trim();
        if line.is_empty() {
            continue;
        }

        let event: ServerEvent = match serde_json::from_str(line) {
            Ok(ev) => ev,
            Err(e) => {
                warn!("[analyzer] Skipping unparseable event: {e}; line={line:?}");
                continue;
            }
        };

        match event {
            ServerEvent::Progress { pct, msg } => {
                if !msg.is_empty() {
                    info!("[analyzer] progress {pct}% {msg}");
                }
                if let Some(hash) = progress_hash {
                    update_queue_status(hash, QueuedStatus::Analyzing(pct as usize));
                }
            }
            ServerEvent::Done { .. } => return Ok(SongResult::Done),
            ServerEvent::Error { kind, msg } => {
                let kind_s = kind.as_deref().unwrap_or("generic");
                if kind_s == "oom" {
                    return Ok(SongResult::Oom);
                }
                let msg = if msg.is_empty() {
                    "Unknown error".to_string()
                } else {
                    msg
                };
                return Ok(SongResult::Error(msg));
            }
            ServerEvent::Unknown => {
                warn!("[analyzer] Ignoring unknown event: {line}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spawns_one_worker_per_queued_song_up_to_the_cap() {
        let idle = HashSet::new();
        // One song, one worker; two-plus songs fill the pool.
        assert_eq!(slots_to_spawn(&idle, 1, 2), vec![0]);
        assert_eq!(slots_to_spawn(&idle, 5, 2), vec![0, 1]);
        // A worker already running only gets a partner, on the free slot.
        assert_eq!(slots_to_spawn(&HashSet::from([0]), 3, 2), vec![1]);
        assert_eq!(slots_to_spawn(&HashSet::from([1]), 3, 2), vec![0]);
        // Configured down to one worker, or already full: nothing new.
        assert!(slots_to_spawn(&HashSet::from([0]), 9, 1).is_empty());
        assert!(slots_to_spawn(&HashSet::from([0, 1]), 9, 2).is_empty());
        // Empty queue never spawns.
        assert!(slots_to_spawn(&idle, 0, 2).is_empty());
    }
}
