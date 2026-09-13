//! One-off YouTube Import: pull a single video or a whole playlist into the
//! active Folder library. An Import is not a Source (see docs/adr/0001) — it is
//! only valid when the active library is a Folder. Imported files are written
//! into the watched folder (a playlist also gets a matching `.m3u`) and picked
//! up by the normal folder scan, so they flow through analysis + LRCLIB lyrics
//! exactly like any other local file.

use std::collections::{BTreeMap, BTreeSet};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tracing::warn;
use ts_rs::TS;

use crate::config::{AppConfig, LibrarySource};
use crate::vendor::{ensure_ytdlp, ffmpeg_path, silent_command};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ImportEntry {
    /// YouTube video id — the stable handle we re-download by.
    pub id: String,
    pub title: String,
    pub artist: String,
    #[serde(default)]
    pub duration_secs: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub is_playlist: bool,
    /// Stable playlist id (yt-dlp `id`), used to recognise a re-import of the
    /// same playlist and reuse its `.m3u`. `None` for a single video.
    pub playlist_id: Option<String>,
    /// Playlist title, when the URL resolved to a playlist.
    pub playlist_title: Option<String>,
    pub entries: Vec<ImportEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ImportFailure {
    pub title: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub imported: usize,
    /// Entries already present from a previous import (id matched, file on disk).
    pub skipped: usize,
    pub failed: Vec<ImportFailure>,
    pub playlist_name: Option<String>,
}

/// Where one entry has got to. Terminal for everything but `Downloading`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ImportEntryStatus {
    Downloading,
    Imported,
    /// Already on disk from an earlier run, or a repeat of an id this run
    /// already claimed (see `already_have`).
    Skipped,
    Failed,
}

/// One entry's state at a point in time. Several entries download at once
/// (`DOWNLOAD_CONCURRENCY`), so a listener keyed by `id` can show each of them
/// moving independently — which the aggregate counters below cannot express.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ImportEntryProgress {
    /// YouTube video id — the stable key a listener addresses rows by.
    pub id: String,
    pub status: ImportEntryStatus,
    /// Download fraction (0.0–1.0). 1.0 for every terminal status.
    pub pct: f64,
    /// Failure text, present only on `Failed`.
    pub reason: Option<String>,
}

/// Progress tick emitted while a (possibly background) import runs.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub done: usize,
    pub total: usize,
    /// Title of the entry currently being downloaded, if any.
    pub current: Option<String>,
    /// Download fraction (0.0–1.0) of the current entry.
    pub current_pct: f64,
    pub imported: usize,
    pub skipped: usize,
    pub failed: usize,
    /// The single entry this tick is about, so a listener can accumulate
    /// per-entry state without the aggregate carrying the whole list every
    /// tick. `None` on the closing summary tick.
    pub entry: Option<ImportEntryProgress>,
}

/// Persisted in the watched folder as `.nightingale-imports.json`. Lets a
/// re-import of the same playlist skip videos already downloaded (delta) and
/// reuse the playlist's `.m3u` instead of spawning a new one.
#[derive(Debug, Default, Serialize, Deserialize)]
struct ImportManifest {
    /// YouTube video id → imported file basename.
    #[serde(default)]
    videos: BTreeMap<String, String>,
    /// Playlist id (or title fallback) → its `.m3u` basename.
    #[serde(default)]
    playlists: BTreeMap<String, String>,
}

/// The watched folder root, iff the active Source is a Folder library.
/// `None` means Import is unavailable (no source, or a remote source).
pub fn import_folder_root() -> Option<PathBuf> {
    match AppConfig::load().library_source {
        Some(LibrarySource::Folder { path }) => Some(path),
        _ => None,
    }
}

pub fn import_available() -> bool {
    import_folder_root().is_some()
}

/// YouTube video ids already imported into the active folder (manifest entry
/// whose file is still on disk). Lets the preview flag/skip re-imports up front,
/// mirroring the delta-skip `run_import` does at download time. Empty when there
/// is no folder library or no manifest yet.
pub fn imported_video_ids() -> Vec<String> {
    let Some(root) = import_folder_root() else {
        return Vec::new();
    };
    let manifest = load_manifest(&root);
    manifest
        .videos
        .into_iter()
        .filter(|(_, name)| root.join(name).exists())
        .map(|(id, _)| id)
        .collect()
}

/// Resolve a YouTube URL to a preview without downloading media. `--flat-playlist`
/// lists playlist entries cheaply; a bare video resolves to a single entry.
pub fn probe(url: &str) -> Result<ImportPreview, String> {
    let (yt, _) = ensure_ytdlp()?;
    let out = silent_command(&yt)
        .args(["--flat-playlist", "--no-warnings", "-J", url])
        .output()
        .map_err(|e| format!("Failed to run yt-dlp: {e}"))?;
    if !out.status.success() {
        return Err(short_err("Could not read URL", &out.stderr));
    }
    let json: serde_json::Value =
        serde_json::from_slice(&out.stdout).map_err(|e| format!("Unexpected yt-dlp output: {e}"))?;

    let is_playlist = json.get("_type").and_then(|v| v.as_str()) == Some("playlist");
    if is_playlist {
        let playlist_id = json.get("id").and_then(|v| v.as_str()).map(str::to_string);
        let playlist_title = json
            .get("title")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let entries = json
            .get("entries")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(entry_from_json).collect())
            .unwrap_or_default();
        Ok(ImportPreview {
            is_playlist: true,
            playlist_id,
            playlist_title,
            entries,
        })
    } else {
        let entry =
            entry_from_json(&json).ok_or_else(|| "yt-dlp returned no usable video".to_string())?;
        Ok(ImportPreview {
            is_playlist: false,
            playlist_id: None,
            playlist_title: None,
            entries: vec![entry],
        })
    }
}

/// How many entries download at once. Each is its own yt-dlp process waiting on
/// the network, so overlapping a few is most of the win; the cap is what keeps a
/// long playlist from spawning a process per track.
const DOWNLOAD_CONCURRENCY: usize = 3;

/// Download each entry into the folder, embedding the (possibly user-edited)
/// title/artist so the folder scan and LRCLIB search see clean metadata.
///
/// Delta-aware: a video already imported (id in the manifest, file still on
/// disk) is skipped, so re-importing a playlist only pulls the new videos.
/// Per-item atomic: a failed entry is recorded and skipped, the rest continue.
/// For a playlist it (re)writes the playlist's `.m3u` — reusing the same file
/// across re-imports — with the full current membership in playlist order, then
/// triggers a rescan.
pub fn run_import(
    preview: &ImportPreview,
    on_progress: impl FnMut(ImportProgress) + Send,
) -> Result<ImportReport, String> {
    let root = import_folder_root()
        .ok_or_else(|| "Import is only available with a Folder library".to_string())?;
    let (yt, ytdlp_updated) = ensure_ytdlp()?;
    std::fs::create_dir_all(&root).map_err(|e| format!("Cannot create library folder: {e}"))?;

    let mut manifest = load_manifest(&root);
    let total = preview.entries.len();

    /// Counters the download workers share. `done` counts finished entries, so
    /// the bar still moves monotonically with several downloads in flight.
    #[derive(Default)]
    struct Shared {
        /// Next entry index to claim.
        next: usize,
        done: usize,
        imported: usize,
        skipped: usize,
        failed: Vec<ImportFailure>,
        /// video id -> imported basename, folded into the manifest at the end.
        videos: Vec<(String, String)>,
        /// Video ids this run has already taken responsibility for downloading.
        claimed: BTreeSet<String>,
    }
    let shared = Mutex::new(Shared::default());
    let emit = Mutex::new(on_progress);
    // Read-only copy for the delta skip; workers append to `shared.videos`.
    let known = manifest.videos.clone();

    // Snapshot the counters and emit one tick. `current` is whichever entry
    // reported last — with several downloading there is no single current one,
    // which is exactly why `entry` carries the per-entry state alongside it.
    // Never called while `shared` is held, so the two locks cannot deadlock.
    let tick = |current: Option<&str>, pct: f64, entry: Option<ImportEntryProgress>| {
        let p = {
            let s = shared.lock().unwrap_or_else(|e| e.into_inner());
            ImportProgress {
                done: s.done,
                total,
                current: current.map(str::to_string),
                current_pct: pct,
                imported: s.imported,
                skipped: s.skipped,
                failed: s.failed.len(),
                entry,
            }
        };
        (emit.lock().unwrap_or_else(|e| e.into_inner()))(p);
    };

    let downloading = |id: &str, pct: f64| ImportEntryProgress {
        id: id.to_string(),
        status: ImportEntryStatus::Downloading,
        pct,
        reason: None,
    };

    std::thread::scope(|scope| {
        for _ in 0..DOWNLOAD_CONCURRENCY.min(total) {
            scope.spawn(|| {
                loop {
                    let index = {
                        let mut s = shared.lock().unwrap_or_else(|e| e.into_inner());
                        let i = s.next;
                        s.next += 1;
                        i
                    };
                    let Some(entry) = preview.entries.get(index) else {
                        return;
                    };
                    tick(Some(&entry.title), 0.0, Some(downloading(&entry.id, 0.0)));

                    // Delta skip: already imported and the file is still there.
                    // Also skip a repeat of an id this run already claimed: a
                    // mix window can list the same video more than once, and
                    // `known` is a pre-run snapshot that never sees what the
                    // workers just downloaded. Without the claim, each repeat
                    // downloads again and `reserve_path` hides the clash behind
                    // a "(1)" suffix, orphaning every copy but the last (which
                    // is all the manifest keeps).
                    let skip = {
                        let mut s = shared.lock().unwrap_or_else(|e| e.into_inner());
                        let seen = already_have(&known, &mut s.claimed, &root, &entry.id);
                        if seen {
                            s.skipped += 1;
                            s.done += 1;
                        }
                        seen
                    };
                    if skip {
                        tick(
                            Some(&entry.title),
                            1.0,
                            Some(ImportEntryProgress {
                                id: entry.id.clone(),
                                status: ImportEntryStatus::Skipped,
                                pct: 1.0,
                                reason: None,
                            }),
                        );
                        continue;
                    }

                    let result = download_entry(&yt, &root, entry, ytdlp_updated, |pct| {
                        tick(Some(&entry.title), pct, Some(downloading(&entry.id, pct)))
                    });
                    // Fold the result into the counters and build this entry's
                    // terminal state, then drop the lock before ticking — `tick`
                    // takes `shared` itself and would deadlock against this guard.
                    let finished = {
                        let mut s = shared.lock().unwrap_or_else(|e| e.into_inner());
                        let finished = match result {
                            Ok(path) => {
                                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                                    s.videos.push((entry.id.clone(), name.to_string()));
                                }
                                s.imported += 1;
                                ImportEntryProgress {
                                    id: entry.id.clone(),
                                    status: ImportEntryStatus::Imported,
                                    pct: 1.0,
                                    reason: None,
                                }
                            }
                            Err(reason) => {
                                warn!("[import] \"{}\" failed: {reason}", entry.title);
                                s.failed.push(ImportFailure {
                                    title: entry.title.clone(),
                                    reason: reason.clone(),
                                });
                                ImportEntryProgress {
                                    id: entry.id.clone(),
                                    status: ImportEntryStatus::Failed,
                                    pct: 1.0,
                                    reason: Some(reason),
                                }
                            }
                        };
                        s.done += 1;
                        finished
                    };
                    tick(Some(&entry.title), 1.0, Some(finished));
                }
            });
        }
    });

    let Shared {
        imported,
        skipped,
        failed,
        videos,
        ..
    } = shared.into_inner().unwrap_or_else(|e| e.into_inner());
    for (id, name) in videos {
        manifest.videos.insert(id, name);
    }

    (emit.lock().unwrap_or_else(|e| e.into_inner()))(ImportProgress {
        done: total,
        total,
        current: None,
        current_pct: 1.0,
        imported,
        skipped,
        failed: failed.len(),
        entry: None,
    });

    let mut wrote_playlist = false;
    // A failed `.m3u` write must not cost us the manifest: every id this run
    // downloaded lives only in `manifest` until `save_manifest` below, and
    // losing it would re-download the whole batch next time. Hold the error
    // and propagate it after the save.
    let mut m3u_error: Option<String> = None;
    let playlist_name = if preview.is_playlist {
        let display = preview
            .playlist_title
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "YouTube Import".to_string());
        let key = preview
            .playlist_id
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| display.clone());

        // Full current membership, in playlist order, of every track we hold.
        let members: Vec<String> = preview
            .entries
            .iter()
            .filter_map(|e| manifest.videos.get(&e.id).cloned())
            .filter(|name| root.join(name).exists())
            .collect();

        if members.is_empty() {
            None
        } else {
            // Reuse this playlist's existing `.m3u` (option A), else mint one.
            let m3u_name = match manifest.playlists.get(&key) {
                Some(existing) if root.join(existing).exists() => existing.clone(),
                _ => file_name_of(unique_path(&root, &display, "m3u")),
            };
            let m3u_path = root.join(&m3u_name);
            // A mix only ever shows a window of itself, so its `.m3u` grows
            // instead of being replaced by the window we happened to see.
            let members = if is_radio_mix(&key) {
                let kept: Vec<String> = read_m3u_members(&m3u_path)
                    .into_iter()
                    .filter(|n| root.join(n).exists())
                    .collect();
                merge_members(&kept, &members)
            } else {
                members
            };
            match write_m3u_members(&m3u_path, &members) {
                Ok(()) => {
                    manifest.playlists.insert(key, m3u_name);
                    wrote_playlist = true;
                    Some(display)
                }
                Err(e) => {
                    m3u_error = Some(e);
                    None
                }
            }
        }
    } else {
        None
    };

    save_manifest(&root, &manifest);
    if let Some(e) = m3u_error {
        return Err(e);
    }

    if imported > 0 || wrote_playlist {
        crate::scanner::start_scan();
    }

    Ok(ImportReport {
        imported,
        skipped,
        failed,
        playlist_name,
    })
}

fn manifest_path(root: &Path) -> PathBuf {
    root.join(".nightingale-imports.json")
}

fn load_manifest(root: &Path) -> ImportManifest {
    std::fs::read(manifest_path(root))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_manifest(root: &Path, m: &ImportManifest) {
    match serde_json::to_vec_pretty(m) {
        Ok(json) => {
            if let Err(e) = std::fs::write(manifest_path(root), json) {
                warn!("[import] failed to write manifest: {e}");
            }
        }
        Err(e) => warn!("[import] failed to serialize manifest: {e}"),
    }
}

fn file_name_of(path: PathBuf) -> String {
    path.file_name()
        .and_then(|s| s.to_str())
        .map(str::to_string)
        .unwrap_or_default()
}

fn entry_from_json(v: &serde_json::Value) -> Option<ImportEntry> {
    let id = v.get("id").and_then(|x| x.as_str())?.to_string();
    if id.is_empty() {
        return None;
    }
    let raw_title = v.get("title").and_then(|x| x.as_str()).unwrap_or("").to_string();
    // Prefer YouTube Music's structured fields; fall back to parsing the title.
    let track = v.get("track").and_then(|x| x.as_str()).map(str::to_string);
    let artist = v
        .get("artist")
        .and_then(|x| x.as_str())
        .or_else(|| v.get("uploader").and_then(|x| x.as_str()))
        .map(clean_artist)
        .unwrap_or_default();
    let (title, artist) = split_title_artist(&raw_title, track, artist);
    let duration_secs = v.get("duration").and_then(|x| x.as_f64()).unwrap_or(0.0);
    Some(ImportEntry {
        id,
        title,
        artist,
        duration_secs,
    })
}

fn clean_artist(a: &str) -> String {
    a.trim().trim_end_matches("- Topic").trim().to_string()
}

/// Best-effort title/artist. Trust YouTube Music's `track` when present;
/// otherwise split a plain `"Artist - Title"` heading.
fn split_title_artist(raw_title: &str, track: Option<String>, artist: String) -> (String, String) {
    if let Some(t) = track.filter(|t| !t.trim().is_empty()) {
        let a = if artist.is_empty() {
            raw_title
                .split_once(" - ")
                .map(|(a, _)| a.trim().to_string())
                .unwrap_or_default()
        } else {
            artist
        };
        return (t.trim().to_string(), a);
    }
    if artist.is_empty() {
        if let Some((a, t)) = raw_title.split_once(" - ") {
            return (t.trim().to_string(), a.trim().to_string());
        }
    }
    (raw_title.trim().to_string(), artist)
}

fn download_entry(
    yt: &Path,
    root: &Path,
    entry: &ImportEntry,
    ytdlp_updated: bool,
    mut on_pct: impl FnMut(f64),
) -> Result<PathBuf, String> {
    let tmp = root.join(format!(".import_tmp_{}", sanitize(&entry.id)));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| format!("Cannot create temp dir: {e}"))?;

    let result = (|| {
        let url = format!("https://www.youtube.com/watch?v={}", entry.id);
        let out_tmpl = tmp.join("%(id)s.%(ext)s");
        // `--newline` + a machine-readable progress template stream download
        // percentage to stdout, one line per update, tagged so we can parse it.
        let mut child = silent_command(yt)
            .args([
                "-f",
                "bv*+ba/b",
                "--merge-output-format",
                "mp4",
                "--no-playlist",
                "--no-warnings",
                "--newline",
                "--progress-template",
                "download:NGPCT %(progress._percent_str)s",
                "-o",
            ])
            .arg(&out_tmpl)
            .arg(&url)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to run yt-dlp: {e}"))?;

        // Drain stderr on a thread so a full pipe can't deadlock the download.
        let stderr = child.stderr.take();
        let err_handle = std::thread::spawn(move || {
            let mut buf = String::new();
            if let Some(stderr) = stderr {
                let _ = BufReader::new(stderr).read_to_string(&mut buf);
            }
            buf
        });

        // Read progress lines, emitting only when the integer percent changes.
        if let Some(stdout) = child.stdout.take() {
            let mut last_bucket: i32 = -1;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(pct) = parse_pct(&line) {
                    let bucket = (pct * 100.0) as i32;
                    if bucket != last_bucket {
                        last_bucket = bucket;
                        on_pct(pct);
                    }
                }
            }
        }

        let status = child
            .wait()
            .map_err(|e| format!("yt-dlp wait failed: {e}"))?;
        let stderr_str = err_handle.join().unwrap_or_default();
        if !status.success() {
            // A stale yt-dlp is the usual cause when the self-update also failed;
            // say so instead of a generic failure (docs/adr/0002).
            let prefix = if ytdlp_updated {
                "Download failed"
            } else {
                "Download failed — yt-dlp may be outdated (its self-update failed)"
            };
            return Err(short_err(prefix, stderr_str.as_bytes()));
        }

        let downloaded = first_file_in(&tmp).ok_or("yt-dlp produced no file")?;
        let dest = reserve_path(root, &format!("{} - {}", entry.artist, entry.title), "mp4");
        if let Err(e) = embed_and_move(&downloaded, &dest, &entry.title, &entry.artist) {
            // Don't leave the empty placeholder behind for the folder scan.
            let _ = std::fs::remove_file(&dest);
            return Err(e);
        }
        Ok(dest)
    })();

    let _ = std::fs::remove_dir_all(&tmp);
    result
}

/// Parse a percentage from a tagged yt-dlp progress line
/// (`download:NGPCT  45.2%`) into a 0.0–1.0 fraction.
fn parse_pct(line: &str) -> Option<f64> {
    const MARKER: &str = "NGPCT";
    let idx = line.find(MARKER)? + MARKER.len();
    let rest = line[idx..].trim().trim_end_matches('%').trim();
    rest.parse::<f64>().ok().map(|p| (p / 100.0).clamp(0.0, 1.0))
}

/// Stream-copy `src` into `dest` while stamping title/artist tags (fast, no
/// re-encode). Falls back to a plain move if ffmpeg is missing or errors — the
/// file still imports, just with weaker metadata.
fn embed_and_move(src: &Path, dest: &Path, title: &str, artist: &str) -> Result<(), String> {
    let ff = ffmpeg_path();
    if ff.is_file() {
        let out = silent_command(&ff)
            .arg("-y")
            .arg("-i")
            .arg(src)
            .args(["-map", "0", "-c", "copy", "-metadata"])
            .arg(format!("title={title}"))
            .arg("-metadata")
            .arg(format!("artist={artist}"))
            .arg(dest)
            .output()
            .map_err(|e| format!("Failed to run ffmpeg: {e}"))?;
        if out.status.success() {
            return Ok(());
        }
        warn!(
            "[import] ffmpeg metadata embed failed, moving file as-is: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    std::fs::rename(src, dest)
        .or_else(|_| std::fs::copy(src, dest).map(|_| ()))
        .map_err(|e| format!("Failed to move imported file: {e}"))
}

/// Whether this video is already accounted for, so the worker can skip it.
///
/// Two ways that happens: a previous run imported it and the file is still on
/// disk (`known`, the delta skip), or this run already claimed it. The second
/// case is what stops a mix window that lists the same video twice from
/// downloading it twice — `known` is a pre-run snapshot, so it never sees what
/// the workers are producing right now, and `reserve_path` would happily give
/// the second copy a "(1)" name instead of colliding. Claims the id as a side
/// effect, so callers must hold the shared lock across the call.
fn already_have(
    known: &BTreeMap<String, String>,
    claimed: &mut BTreeSet<String>,
    root: &Path,
    id: &str,
) -> bool {
    if known.get(id).is_some_and(|name| root.join(name).exists()) {
        return true;
    }
    !claimed.insert(id.to_string())
}

/// YouTube radio/mix ids (`RDTMAK5…`, `RDMM…`, `RDCLAK5…`) name an endless,
/// server-generated station. A probe only ever returns a moving window of it,
/// so unlike a real playlist its membership is not the whole truth.
fn is_radio_mix(playlist_id: &str) -> bool {
    playlist_id.starts_with("RD")
}

/// Existing track basenames in an `.m3u`, ignoring the `#EXTM3U` header and any
/// other comment lines. Missing or unreadable file reads as empty.
fn read_m3u_members(path: &Path) -> Vec<String> {
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(str::to_string)
        .collect()
}

/// Append what is new, keeping the order already on disk. Used for mixes, where
/// replacing the file with the current window would drop earlier tracks.
fn merge_members(existing: &[String], fresh: &[String]) -> Vec<String> {
    let mut out = existing.to_vec();
    for name in fresh {
        if !out.contains(name) {
            out.push(name.clone());
        }
    }
    out
}

fn write_m3u_members(path: &Path, basenames: &[String]) -> Result<(), String> {
    let mut body = String::from("#EXTM3U\n");
    for n in basenames {
        body.push_str(n);
        body.push('\n');
    }
    std::fs::write(path, body).map_err(|e| format!("Failed to write playlist: {e}"))
}

/// Claim a free filename by creating it empty, so two concurrent downloads
/// can't settle on the same one (whoever writes it next overwrites the
/// placeholder). ponytail: one global lock — it is held for a `create`, per-root
/// locks only if imports ever run against several libraries at once.
fn reserve_path(root: &Path, stem: &str, ext: &str) -> PathBuf {
    static LOCK: Mutex<()> = Mutex::new(());
    let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let path = unique_path(root, stem, ext);
    let _ = std::fs::File::create(&path);
    path
}

fn unique_path(root: &Path, stem: &str, ext: &str) -> PathBuf {
    let base = {
        let s = sanitize(stem.trim().trim_start_matches("- ").trim());
        if s.is_empty() {
            "youtube-import".to_string()
        } else {
            s
        }
    };
    let mut candidate = root.join(format!("{base}.{ext}"));
    let mut n = 1;
    while candidate.exists() {
        candidate = root.join(format!("{base} ({n}).{ext}"));
        n += 1;
    }
    candidate
}

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| if "/\\:*?\"<>|".contains(c) { '_' } else { c })
        .collect::<String>()
        .trim()
        .to_string()
}

fn first_file_in(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .find(|p| p.is_file())
}

/// Collapse a multi-line stderr into a single short reason for the UI. yt-dlp
/// puts the useful line last (`ERROR: ...`).
fn short_err(prefix: &str, stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let line = text
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim();
    if line.is_empty() {
        prefix.to_string()
    } else {
        format!("{prefix}: {line}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_prefers_track_field() {
        let (t, a) = split_title_artist("RM - Song (Official)", Some("Song".into()), "RM".into());
        assert_eq!(t, "Song");
        assert_eq!(a, "RM");
    }

    #[test]
    fn split_falls_back_to_dash() {
        let (t, a) = split_title_artist("Artist - Title", None, String::new());
        assert_eq!(t, "Title");
        assert_eq!(a, "Artist");
    }

    #[test]
    fn split_no_dash_keeps_raw_title() {
        let (t, a) = split_title_artist("Just A Title", None, String::new());
        assert_eq!(t, "Just A Title");
        assert_eq!(a, "");
    }

    #[test]
    fn clean_artist_strips_topic() {
        assert_eq!(clean_artist("Some Artist - Topic"), "Some Artist");
    }

    #[test]
    fn sanitize_removes_path_separators() {
        assert_eq!(sanitize("a/b:c?"), "a_b_c_");
    }

    #[test]
    fn parse_pct_reads_tagged_line() {
        assert_eq!(parse_pct("download:NGPCT  45.2%"), Some(0.452));
        assert_eq!(parse_pct("download:NGPCT 100.0%"), Some(1.0));
        assert_eq!(parse_pct("[download] fragment 1"), None);
    }

    #[test]
    fn manifest_round_trips() {
        let mut m = ImportManifest::default();
        m.videos.insert("abc".into(), "A - B.mp4".into());
        m.playlists.insert("PL1".into(), "List.m3u".into());
        let json = serde_json::to_vec(&m).unwrap();
        let back: ImportManifest = serde_json::from_slice(&json).unwrap();
        assert_eq!(back.videos.get("abc").unwrap(), "A - B.mp4");
        assert_eq!(back.playlists.get("PL1").unwrap(), "List.m3u");
    }

    #[test]
    fn reserve_path_gives_each_concurrent_caller_its_own_name() {
        let dir = std::env::temp_dir().join(format!("ng_reserve_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let paths: Vec<PathBuf> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..DOWNLOAD_CONCURRENCY)
                .map(|_| scope.spawn(|| reserve_path(&dir, "X - Y", "mp4")))
                .collect();
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });

        let unique: std::collections::BTreeSet<_> = paths.iter().collect();
        assert_eq!(
            unique.len(),
            DOWNLOAD_CONCURRENCY,
            "names collided: {paths:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn unique_path_appends_counter_on_clash() {
        let dir = std::env::temp_dir().join(format!("ng_import_test_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let first = unique_path(&dir, "X - Y", "mp4");
        std::fs::write(&first, b"x").unwrap();
        let second = unique_path(&dir, "X - Y", "mp4");
        assert_ne!(first, second);
        assert!(second.to_string_lossy().contains("(1)"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn repeated_video_id_downloads_once_per_run() {
        let dir = std::env::temp_dir().join(format!("ng_claim_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        let mut known = BTreeMap::new();
        let mut claimed = BTreeSet::new();

        // A mix window listing the same video three times downloads it once.
        assert!(!already_have(&known, &mut claimed, &dir, "vid1"));
        assert!(already_have(&known, &mut claimed, &dir, "vid1"));
        assert!(already_have(&known, &mut claimed, &dir, "vid1"));

        // Delta skip still applies, but only when the file is really there.
        known.insert("vid2".to_string(), "A - Two.mp4".to_string());
        assert!(!already_have(&known, &mut claimed, &dir, "vid2"));
        std::fs::write(dir.join("A - Two.mp4"), b"x").unwrap();
        let mut fresh = BTreeSet::new();
        assert!(already_have(&known, &mut fresh, &dir, "vid2"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn radio_mix_playlist_grows_instead_of_being_replaced() {
        assert!(is_radio_mix("RDTMAK5uy_lr0LWzGrq6FU9GIxWvFHTRPQD2LHMqlFA"));
        assert!(!is_radio_mix("PLabc123"));

        let dir = std::env::temp_dir().join(format!("ng_mix_test_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let m3u = dir.join("Mix.m3u");
        write_m3u_members(&m3u, &["A - One.mp4".into(), "B - Two.mp4".into()]).unwrap();

        // The next probe of the same mix returns a different window.
        let window = vec!["B - Two.mp4".to_string(), "C - Three.mp4".to_string()];
        let merged = merge_members(&read_m3u_members(&m3u), &window);
        assert_eq!(merged, ["A - One.mp4", "B - Two.mp4", "C - Three.mp4"]);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
