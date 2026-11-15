mod vendor;

use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

use app_core::{
    AnalysisQueue, AppConfig, CacheStats, LibraryMenuItems, LibrarySource, LoadSongsParams,
    PixabayVideoDownloaded, PlaybackQueue, PlaybackSession, PlaybackSessionStore, ProfileStore,
    SongTarget, SongsStore, ensure_mp3_stems_ready_payload, load_lyrics_file, load_sidecar_lrc,
    save_lyrics_and_realign, search_lrclib_for_hash, shift_key_done_payload,
    shift_tempo_done_payload,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub trait CommandRuntime: Send + Sync + 'static {
    fn emit(&self, name: &str, payload: Value);

    fn set_monitor_gain(&self, _gain: f32) {}

    fn allow_directory(&self, _path: &Path) -> Result<(), String> {
        Ok(())
    }

    fn resolve_export_directory(&self, requested: Option<&Path>) -> Result<PathBuf, String> {
        requested
            .map(Path::to_path_buf)
            .ok_or_else(|| "export destination required".to_string())
    }
}

#[derive(Clone)]
pub struct CommandState {
    runtime: Arc<dyn CommandRuntime>,
    playback_queue: Arc<PlaybackQueue>,
    playback_sessions: Arc<PlaybackSessionStore>,
    playback_status: Arc<Mutex<PlaybackStatus>>,
    playback_progress: Arc<Mutex<PlaybackProgress>>,
    playback_options: Arc<Mutex<PlaybackOptions>>,
    remote_microphones: Arc<Mutex<Vec<RemoteMicrophone>>>,
}

impl CommandState {
    /// Reads the saved playback queue, so the library must already be open.
    pub fn new(runtime: Arc<dyn CommandRuntime>) -> Self {
        Self {
            runtime,
            playback_queue: Arc::new(PlaybackQueue::load()),
            playback_sessions: Arc::new(PlaybackSessionStore::default()),
            playback_status: Arc::new(Mutex::new(PlaybackStatus::default())),
            playback_progress: Arc::new(Mutex::new(PlaybackProgress::default())),
            playback_options: Arc::new(Mutex::new(PlaybackOptions::default())),
            remote_microphones: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Shared with the party remote so phone edits and host edits hit one queue.
    pub fn playback_queue(&self) -> Arc<PlaybackQueue> {
        self.playback_queue.clone()
    }

    fn playback_status(&self) -> PlaybackStatus {
        self.playback_status
            .lock()
            .map(|status| *status)
            .unwrap_or_default()
    }

    fn set_playback_status(&self, next: PlaybackStatus) -> PlaybackStatus {
        let Ok(mut status) = self.playback_status.lock() else {
            return PlaybackStatus::default();
        };
        *status = next;
        *status
    }

    fn playback_progress(&self) -> PlaybackProgress {
        self.playback_progress
            .lock()
            .map(|progress| progress.clone())
            .unwrap_or_default()
    }

    fn set_playback_progress(&self, next: PlaybackProgress) -> PlaybackProgress {
        let Ok(mut progress) = self.playback_progress.lock() else {
            return PlaybackProgress::default();
        };
        *progress = next;
        progress.clone()
    }

    fn playback_options(&self) -> PlaybackOptions {
        self.playback_options
            .lock()
            .map(|options| options.clone())
            .unwrap_or_default()
    }

    fn set_playback_options(&self, next: PlaybackOptions) -> PlaybackOptions {
        let Ok(mut options) = self.playback_options.lock() else {
            return PlaybackOptions::default();
        };
        *options = next;
        options.clone()
    }

    fn remote_microphones(&self) -> Vec<RemoteMicrophone> {
        self.remote_microphones
            .lock()
            .map(|microphones| microphones.clone())
            .unwrap_or_default()
    }

    fn set_remote_microphones(&self, microphones: Vec<RemoteMicrophone>) -> Vec<RemoteMicrophone> {
        let Ok(mut stored) = self.remote_microphones.lock() else {
            return Vec::new();
        };
        *stored = microphones;
        stored.clone()
    }
}

/// What a remote client needs to know to mirror the host's playback actions.
/// The playback surface publishes it; other clients (the phone) read it. It
/// lives in the transport-neutral command state so desktop and web agree.
#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackStatus {
    pub active: bool,
    pub paused: bool,
    /// The end-of-song result screen is up.
    pub finished: bool,
    /// The queue has another entry to start.
    pub has_next: bool,
    /// Playback owns a separate window, which changes the exit wording.
    pub session_playback: bool,
}

/// Microphone the host offers to remote clients. Device IDs only mean
/// something on the host, so the phone picks from this published list.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteMicrophone {
    pub device_id: String,
    pub label: String,
}

/// What the playback surface publishes continuously so a remote can mirror the
/// host's transport without owning a second clock. The host interpolates its
/// own timeline; remotes only read what it last published.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackProgress {
    pub active: bool,
    /// The audio engine is advancing, so a remote may interpolate between updates.
    pub playing: bool,
    pub paused: bool,
    pub finished: bool,
    pub has_next: bool,
    pub session_playback: bool,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub skip_intro: bool,
    pub skip_outro: bool,
    /// Song the host is playing, so a remote can ask for its lyrics. Opaque id.
    #[serde(default)]
    pub file_hash: Option<String>,
    /// Absolute targets so remotes never guess a lyric boundary themselves.
    pub previous_line_ms: Option<u64>,
    pub next_line_ms: Option<u64>,
}

/// A labelled choice the host offers to remotes. Keys stay opaque to the
/// transport; the host is the only side that knows what they resolve to.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteOption {
    pub key: String,
    pub label: String,
}

/// Playback settings the host offers to remotes. Published on change only: it
/// carries option lists, so it must not ride the progress tick.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackOptions {
    pub guide_volume: f32,
    pub guide_available: bool,
    /// Several singers own their own microphones, so remotes hide per-singer controls.
    pub multiplayer: bool,
    pub mic_enabled: bool,
    pub mic_monitor_enabled: bool,
    pub selected_mic_id: Option<String>,
    pub microphones: Vec<RemoteMicrophone>,
    pub themes: Vec<RemoteOption>,
    pub theme_key: String,
    pub flavors: Vec<RemoteOption>,
    pub flavor_key: String,
    pub flavor_available: bool,
    #[serde(default)]
    pub lyrics_hidden: bool,
    /// Display-only lyric offset on the running song; positive shows lines later.
    #[serde(default)]
    pub lyric_offset_ms: i64,
    /// Host setting `party_lyric_shift`: whether remotes may move the offset.
    #[serde(default)]
    pub lyric_shift_allowed: bool,
}

/// Fine-grained transport and settings actions a remote can request. Values are
/// checked against the published snapshot before the playback surface sees them.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(
    tag = "type",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum PlaybackControl {
    Seek { position_ms: u64 },
    SkipIntro,
    SkipOutro,
    SetGuideVolume { volume: f32 },
    ToggleMic,
    SelectMic { device_id: String },
    ToggleMonitoring,
    SelectTheme { key: String },
    SelectFlavor { key: String },
    ToggleLyrics,
    ShiftLyrics { delta_ms: i64 },
}

/// Actions a remote can ask the playback surface to perform.
#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PlaybackCommand {
    Pause,
    Resume,
    /// Start the next queued entry, abandoning the current song if needed.
    Next,
    Exit,
}

/// Largest single lyric shift a remote may request; the editor's biggest step is 1s.
const MAX_LYRIC_SHIFT_STEP_MS: i64 = 5_000;

fn sanitize_control(
    control: PlaybackControl,
    options: &PlaybackOptions,
    progress: &PlaybackProgress,
) -> Option<PlaybackControl> {
    match control {
        PlaybackControl::Seek { position_ms } => Some(PlaybackControl::Seek {
            position_ms: position_ms.min(progress.duration_ms),
        }),
        PlaybackControl::SkipIntro => Some(PlaybackControl::SkipIntro),
        PlaybackControl::SkipOutro => Some(PlaybackControl::SkipOutro),
        PlaybackControl::SetGuideVolume { volume } => (options.guide_available
            && volume.is_finite())
        .then(|| PlaybackControl::SetGuideVolume {
            volume: volume.clamp(0.0, 1.0),
        }),
        PlaybackControl::ToggleMic if !options.multiplayer => Some(PlaybackControl::ToggleMic),
        PlaybackControl::ToggleMonitoring if !options.multiplayer => {
            Some(PlaybackControl::ToggleMonitoring)
        }
        PlaybackControl::SelectMic { device_id }
            if !options.multiplayer
                && options
                    .microphones
                    .iter()
                    .any(|microphone| microphone.device_id == device_id) =>
        {
            Some(PlaybackControl::SelectMic { device_id })
        }
        PlaybackControl::SelectTheme { key }
            if options.themes.iter().any(|theme| theme.key == key) =>
        {
            Some(PlaybackControl::SelectTheme { key })
        }
        PlaybackControl::SelectFlavor { key }
            if options.flavor_available
                && options.flavors.iter().any(|flavor| flavor.key == key) =>
        {
            Some(PlaybackControl::SelectFlavor { key })
        }
        PlaybackControl::ToggleLyrics => Some(PlaybackControl::ToggleLyrics),
        PlaybackControl::ShiftLyrics { delta_ms } if options.lyric_shift_allowed => {
            Some(PlaybackControl::ShiftLyrics {
                delta_ms: delta_ms.clamp(-MAX_LYRIC_SHIFT_STEP_MS, MAX_LYRIC_SHIFT_STEP_MS),
            })
        }
        _ => None,
    }
}

#[derive(Debug, Deserialize)]
struct PlaybackCommandArgs {
    command: PlaybackCommand,
}

#[derive(Debug, Serialize)]
struct PlaybackCommandRequest {
    command: PlaybackCommand,
}

#[derive(Debug)]
pub struct CommandError {
    status: u16,
    message: String,
}

impl CommandError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: 400,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: 500,
            message: message.into(),
        }
    }

    pub fn status(&self) -> u16 {
        self.status
    }
}

impl std::fmt::Display for CommandError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for CommandError {}

type ApiError = CommandError;
type CmdResult = Result<Value, CommandError>;

#[derive(Clone)]
struct EventEmitter(Arc<dyn CommandRuntime>);

impl EventEmitter {
    fn emit<T: Serialize>(&self, name: &str, payload: &T) {
        if let Ok(value) = serde_json::to_value(payload) {
            self.0.emit(name, value);
        }
    }

    fn emit_value(&self, name: &str, payload: Value) {
        self.0.emit(name, payload);
    }

    fn allow_directory(&self, path: &Path) -> Result<(), String> {
        self.0.allow_directory(path)
    }
}

pub async fn dispatch(state: CommandState, name: &str, payload: Value) -> CmdResult {
    let events = EventEmitter(state.runtime.clone());

    match name {
        // ── Config ───────────────────────────────────────────────────────
        "load_config" => Ok(serde_json::to_value(AppConfig::load()).map_err(serde_err)?),
        "save_config" => save_config_cmd(events, payload),

        // ── Backgrounds ─────────────────────────────────────────────────
        "add_custom_background_url" => add_custom_background_url_cmd(payload),
        "remove_custom_background" => remove_custom_background_cmd(payload),
        "resolve_custom_background_path" => resolve_custom_background_path_cmd(payload),
        "load_custom_background_shader" => load_custom_background_shader_cmd(payload),

        // ── Cache ────────────────────────────────────────────────────────
        "calculate_cache_stats" => {
            Ok(serde_json::to_value(CacheStats::calculate()).map_err(serde_err)?)
        }
        "clear_videos_command" => {
            app_core::clear_videos();
            Ok(Value::Null)
        }
        "clear_models_command" => {
            app_core::clear_models();
            Ok(Value::Null)
        }
        "clear_songs_command" => {
            app_core::clear_songs();
            Ok(Value::Null)
        }
        "sweep_orphan_cache_command" => {
            let report = tokio::task::spawn_blocking(app_core::sweep_orphan_cache)
                .await
                .map_err(blocking_task_err)?
                .map_err(ApiError::bad_request)?;
            Ok(serde_json::to_value(report).map_err(serde_err)?)
        }
        "clear_all" => {
            app_core::clear_models();
            app_core::clear_videos();
            app_core::clear_songs();
            Ok(Value::Null)
        }

        // ── Import ───────────────────────────────────────────────────────
        "import_queue" => Ok(serde_json::to_value(app_core::import_queue()).map_err(serde_err)?),
        "clear_finished_imports" => {
            Ok(serde_json::to_value(app_core::clear_finished_imports()).map_err(serde_err)?)
        }

        // ── Profile ──────────────────────────────────────────────────────
        "load_profiles" => Ok(serde_json::to_value(ProfileStore::load()).map_err(serde_err)?),
        "create_profile" => {
            let args: NameArgs = deserialize(payload)?;
            let mut store = ProfileStore::load();
            store.create_profile(args.name);
            Ok(Value::Null)
        }
        "switch_profile" => {
            let args: NameArgs = deserialize(payload)?;
            let mut store = ProfileStore::load();
            store.switch_profile(&args.name);
            Ok(Value::Null)
        }
        "delete_profile" => {
            let args: NameArgs = deserialize(payload)?;
            let mut store = ProfileStore::load();
            store.delete_profile(&args.name);
            Ok(Value::Null)
        }
        "add_score" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                song_hash: String,
                score: u32,
                profile: Option<String>,
            }
            let args: Args = deserialize(payload)?;
            let mut store = ProfileStore::load();
            store.add_score(&args.song_hash, args.score, args.profile.as_deref());
            Ok(Value::Null)
        }

        // ── Playback queue ───────────────────────────────────────────────
        "load_playback_queue" => {
            let entries = state.playback_queue.entries().map_err(ApiError::internal)?;
            Ok(serde_json::to_value(entries).map_err(serde_err)?)
        }
        "add_playback_queue_entry" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                file_hash: String,
                tempo: f64,
                key_offset: i32,
                #[serde(default)]
                add_to_front: bool,
            }
            let args: Args = deserialize(payload)?;
            let entries = state
                .playback_queue
                .add(
                    &args.file_hash,
                    args.tempo,
                    args.key_offset,
                    args.add_to_front,
                )
                .map_err(ApiError::bad_request)?;
            events.emit("playback-queue-changed", &entries);
            Ok(serde_json::to_value(entries).map_err(serde_err)?)
        }
        "move_playback_queue_entry" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                id: String,
                target_index: usize,
            }
            let args: Args = deserialize(payload)?;
            let entries = state
                .playback_queue
                .move_entry(&args.id, args.target_index)
                .map_err(ApiError::bad_request)?;
            events.emit("playback-queue-changed", &entries);
            Ok(serde_json::to_value(entries).map_err(serde_err)?)
        }
        "remove_playback_queue_entry" => {
            #[derive(Deserialize)]
            struct Args {
                id: String,
            }
            let args: Args = deserialize(payload)?;
            let entries = state
                .playback_queue
                .remove(&args.id)
                .map_err(ApiError::internal)?;
            events.emit("playback-queue-changed", &entries);
            Ok(serde_json::to_value(entries).map_err(serde_err)?)
        }
        "clear_playback_queue" => {
            let entries = state.playback_queue.clear().map_err(ApiError::internal)?;
            events.emit("playback-queue-changed", &entries);
            Ok(serde_json::to_value(entries).map_err(serde_err)?)
        }

        // ── Playback control ─────────────────────────────────────────────
        "load_playback_status" => {
            Ok(serde_json::to_value(state.playback_status()).map_err(serde_err)?)
        }
        "set_playback_status" => {
            let status: PlaybackStatus = deserialize(payload)?;
            let status = state.set_playback_status(status);
            events.emit("playback-status-changed", &status);
            Ok(Value::Null)
        }
        "request_playback_command" => {
            let args: PlaybackCommandArgs = deserialize(payload)?;
            events.emit(
                "playback-command-requested",
                &PlaybackCommandRequest {
                    command: args.command,
                },
            );
            Ok(Value::Null)
        }
        "request_queue_playback" => {
            // The phone may name the singers; the host resolves microphones.
            events.emit_value("playback-queue-play-requested", payload);
            Ok(Value::Null)
        }
        // The phone may start a song when nothing is queued; the menu draws one.
        "request_random_playback" => {
            events.emit_value("playback-random-requested", Value::Null);
            Ok(Value::Null)
        }
        // Lyrics of the song the host is playing, and nothing else: a remote
        // cannot name a song, so it cannot read the rest of the library's words.
        "load_remote_lyrics" => {
            let Some(file_hash) = state.playback_progress().file_hash else {
                return serde_json::to_value(RemoteLyrics::default()).map_err(serde_err);
            };
            let lines = tokio::task::spawn_blocking(move || app_core::lyric_lines(&file_hash))
                .await
                .map_err(blocking_task_err)?;
            Ok(serde_json::to_value(RemoteLyrics { lines }).map_err(serde_err)?)
        }
        "load_remote_imports" => {
            require_remote_import()?;
            let rows: Vec<RemoteImport> = app_core::import_queue()
                .iter()
                .map(RemoteImport::from)
                .collect();
            Ok(serde_json::to_value(rows).map_err(serde_err)?)
        }
        "submit_remote_import" => {
            require_remote_import()?;
            #[derive(Deserialize)]
            struct Args {
                url: String,
            }
            let args: Args = deserialize(payload)?;
            let row = submit_remote_import(args.url).await?;
            Ok(serde_json::to_value(row).map_err(serde_err)?)
        }
        "load_playback_progress" => {
            Ok(serde_json::to_value(state.playback_progress()).map_err(serde_err)?)
        }
        "set_playback_progress" => {
            let progress: PlaybackProgress = deserialize(payload)?;
            let progress = state.set_playback_progress(progress);
            events.emit("playback-progress-changed", &progress);
            Ok(Value::Null)
        }
        "load_playback_options" => {
            Ok(serde_json::to_value(state.playback_options()).map_err(serde_err)?)
        }
        "set_playback_options" => {
            let options: PlaybackOptions = deserialize(payload)?;
            let options = state.set_playback_options(options);
            events.emit("playback-options-changed", &options);
            Ok(Value::Null)
        }
        "request_playback_control" => {
            let control: PlaybackControl = deserialize(payload)?;
            let control = sanitize_control(
                control,
                &state.playback_options(),
                &state.playback_progress(),
            )
            .ok_or_else(|| ApiError::bad_request("playback control is not available"))?;
            events.emit("playback-control-requested", &control);
            Ok(Value::Null)
        }
        // The phone has no bootstrap payload (it is served by the LAN router),
        // so it asks for the interface language explicitly.
        "load_interface_language" => {
            Ok(serde_json::to_value(AppConfig::load().language).map_err(serde_err)?)
        }
        "load_remote_microphones" => {
            Ok(serde_json::to_value(state.remote_microphones()).map_err(serde_err)?)
        }
        "set_remote_microphones" => {
            #[derive(Deserialize)]
            struct Args {
                microphones: Vec<RemoteMicrophone>,
            }
            let Args { microphones } = deserialize(payload)?;
            Ok(
                serde_json::to_value(state.set_remote_microphones(microphones))
                    .map_err(serde_err)?,
            )
        }

        // ── Playback session ─────────────────────────────────────────────
        "load_playback_session" => {
            let session = state.playback_sessions.load().map_err(ApiError::internal)?;
            Ok(serde_json::to_value(session).map_err(serde_err)?)
        }
        "save_playback_session" => {
            #[derive(Deserialize)]
            struct Args {
                session: PlaybackSession,
            }
            let args: Args = deserialize(payload)?;
            let session = state
                .playback_sessions
                .save(args.session)
                .map_err(ApiError::internal)?;
            events.emit("playback-session-changed", &session);
            Ok(serde_json::to_value(session).map_err(serde_err)?)
        }

        // ── Scanner ──────────────────────────────────────────────────────
        "trigger_scan" => {
            app_core::start_scan();
            Ok(Value::Null)
        }
        "reconcile_cache" => {
            let summary = tokio::task::spawn_blocking(app_core::reconcile_cache)
                .await
                .map_err(blocking_task_err)?
                .map_err(ApiError::internal)?;
            Ok(serde_json::to_value(summary).map_err(serde_err)?)
        }
        "set_library_source" => {
            #[derive(Deserialize)]
            struct Args {
                source: LibrarySource,
            }
            let args: Args = deserialize(payload)?;
            let mut config = AppConfig::load();
            config.library_source = Some(args.source);
            config.last_folder = None;
            config.save();
            app_core::start_scan();
            Ok(serde_json::to_value(config).map_err(serde_err)?)
        }
        "clear_library_source" => {
            let mut config = AppConfig::load();
            config.library_source = None;
            config.last_folder = None;
            config.save();
            Ok(serde_json::to_value(config).map_err(serde_err)?)
        }
        "jellyfin_login" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                base_url: String,
                username: String,
                password: String,
            }
            let args: Args = deserialize(payload)?;
            let result =
                app_core::jellyfin_login(&args.base_url, &args.username, &args.password, None)
                    .map_err(|e| ApiError::bad_request(e.to_string()))?;
            Ok(serde_json::to_value(result).map_err(serde_err)?)
        }
        "jellyfin_ping" => {
            Ok(serde_json::to_value(app_core::jellyfin_ping_current()).map_err(serde_err)?)
        }
        "navidrome_login" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                base_url: String,
                username: String,
                password: String,
            }
            let args: Args = deserialize(payload)?;
            let result = app_core::navidrome_login(&args.base_url, &args.username, &args.password)
                .map_err(|e| ApiError::bad_request(e.to_string()))?;
            Ok(serde_json::to_value(result).map_err(serde_err)?)
        }
        "navidrome_ping" => {
            Ok(serde_json::to_value(app_core::navidrome_ping_current()).map_err(serde_err)?)
        }
        "plex_begin_pin" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                #[serde(default)]
                client_id: Option<String>,
            }
            let args: Args = deserialize(payload)?;
            let result =
                tokio::task::spawn_blocking(move || app_core::plex_begin_pin(args.client_id))
                    .await
                    .map_err(blocking_task_err)?
                    .map_err(|error| ApiError::bad_request(error.to_string()))?;
            Ok(serde_json::to_value(result).map_err(serde_err)?)
        }
        "plex_poll_pin" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                pin_id: String,
                client_id: String,
            }
            let args: Args = deserialize(payload)?;
            let result = tokio::task::spawn_blocking(move || {
                app_core::plex_poll_pin(&args.pin_id, &args.client_id)
            })
            .await
            .map_err(blocking_task_err)?
            .map_err(|error| ApiError::bad_request(error.to_string()))?;
            Ok(serde_json::to_value(result).map_err(serde_err)?)
        }
        "plex_manual_login" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                base_url: String,
                access_token: String,
                #[serde(default)]
                client_id: Option<String>,
            }
            let args: Args = deserialize(payload)?;
            let result = tokio::task::spawn_blocking(move || {
                app_core::plex_manual_login(&args.base_url, &args.access_token, args.client_id)
            })
            .await
            .map_err(blocking_task_err)?
            .map_err(|error| ApiError::bad_request(error.to_string()))?;
            Ok(serde_json::to_value(result).map_err(serde_err)?)
        }
        "plex_ping" => {
            let result = tokio::task::spawn_blocking(app_core::plex_ping_current)
                .await
                .map_err(blocking_task_err)?;
            Ok(serde_json::to_value(result).map_err(serde_err)?)
        }
        "load_songs" => {
            #[derive(Deserialize)]
            struct Args {
                params: LoadSongsParams,
            }
            let args: Args = deserialize(payload)?;
            Ok(serde_json::to_value(SongsStore::load(&args.params)).map_err(serde_err)?)
        }
        "load_songs_by_hashes" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                file_hashes: Vec<String>,
            }
            let args: Args = deserialize(payload)?;
            Ok(
                serde_json::to_value(SongsStore::load_by_hashes(&args.file_hashes))
                    .map_err(serde_err)?,
            )
        }
        "rename_song" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                file_hash: String,
                title: Option<String>,
                artist: Option<String>,
            }
            let args: Args = deserialize(payload)?;
            let song = app_core::rename_song(&args.file_hash, args.title, args.artist)
                .map_err(ApiError::bad_request)?;
            Ok(serde_json::to_value(song).map_err(serde_err)?)
        }
        "record_song_play" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                file_hash: String,
                sung: bool,
            }
            let args: Args = deserialize(payload)?;
            app_core::record_song_play(&args.file_hash, args.sung)
                .map_err(ApiError::bad_request)?;
            Ok(Value::Null)
        }
        "pick_next_song" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                #[serde(default)]
                exclude_file_hash: Option<String>,
            }
            let args: Args = deserialize(payload)?;
            let song = app_core::pick_next_song(args.exclude_file_hash.as_deref())
                .map_err(|e| ApiError::internal(e.to_string()))?;
            Ok(serde_json::to_value(song).map_err(serde_err)?)
        }
        "load_songs_meta" => Ok(serde_json::to_value(SongsStore::load_meta()).map_err(serde_err)?),
        "load_analysis_queue" => {
            Ok(serde_json::to_value(AnalysisQueue::load()).map_err(serde_err)?)
        }
        "load_library_menu_items" => {
            let items: LibraryMenuItems = app_core::load_library_menu_items()
                .map_err(|e| ApiError::internal(e.to_string()))?;
            Ok(serde_json::to_value(items).map_err(serde_err)?)
        }

        // ── Analyzer ─────────────────────────────────────────────────────
        "enqueue" => {
            let args: SongTargetArgs = deserialize(payload)?;
            Ok(Value::from(
                app_core::enqueue(args.target).map_err(ApiError::internal)?,
            ))
        }
        "cancel_analysis" => {
            let args: SongTargetArgs = deserialize(payload)?;
            Ok(Value::from(
                app_core::cancel_analysis(args.target).map_err(ApiError::internal)?,
            ))
        }
        "delete_song_cache" => {
            let args: SongTargetArgs = deserialize(payload)?;
            Ok(Value::from(
                app_core::delete_cache(args.target).map_err(ApiError::internal)?,
            ))
        }
        "delete_song" => {
            let args: SongTargetArgs = deserialize(payload)?;
            Ok(Value::from(
                app_core::delete_song(args.target).map_err(ApiError::bad_request)?,
            ))
        }
        "reanalyze_transcript" => {
            let args: SongTargetLanguageArgs = deserialize(payload)?;
            Ok(Value::from(
                app_core::reanalyze_transcript(args.target, args.language)
                    .map_err(ApiError::internal)?,
            ))
        }
        "reanalyze_full" => {
            let args: SongTargetArgs = deserialize(payload)?;
            Ok(Value::from(
                app_core::reanalyze_full(args.target).map_err(ApiError::internal)?,
            ))
        }
        "realign" => {
            let args: SongTargetLanguageArgs = deserialize(payload)?;
            Ok(Value::from(
                app_core::realign(args.target, args.language).map_err(ApiError::internal)?,
            ))
        }
        "reanalyze_force_transcribe" => {
            let args: SongTargetArgs = deserialize(payload)?;
            Ok(Value::from(
                app_core::reanalyze_force_transcribe(args.target).map_err(ApiError::internal)?,
            ))
        }
        "refresh_metadata" => {
            let args: SongTargetArgs = deserialize(payload)?;
            let count =
                tokio::task::spawn_blocking(move || app_core::refresh_metadata(args.target))
                    .await
                    .map_err(|e| ApiError::internal(e.to_string()))?
                    .map_err(ApiError::internal)?;
            Ok(Value::from(count))
        }
        "shift_key" => shift_key_cmd(events, payload),
        "shift_tempo" => shift_tempo_cmd(events, payload),

        // ── Lyrics ───────────────────────────────────────────────────────
        "load_lyrics" => {
            let args: FileHashArgs = deserialize(payload)?;
            Ok(serde_json::to_value(load_lyrics_file(&args.file_hash)).map_err(serde_err)?)
        }
        "search_lrclib_lyrics" => {
            let args: FileHashArgs = deserialize(payload)?;
            let candidates =
                tokio::task::spawn_blocking(move || search_lrclib_for_hash(&args.file_hash))
                    .await
                    .map_err(blocking_task_err)?;
            Ok(serde_json::to_value(candidates).map_err(serde_err)?)
        }
        "search_lrclib_terms" => {
            #[derive(Deserialize)]
            struct Args {
                track: String,
                artist: String,
            }
            let args: Args = deserialize(payload)?;
            let candidates = tokio::task::spawn_blocking(move || {
                app_core::search_lrclib_terms(&args.track, &args.artist)
            })
            .await
            .map_err(blocking_task_err)?;
            Ok(serde_json::to_value(candidates).map_err(serde_err)?)
        }
        "clear_lyrics" => {
            let args: FileHashArgs = deserialize(payload)?;
            app_core::clear_lyrics(&args.file_hash).map_err(ApiError::bad_request)?;
            Ok(Value::Null)
        }
        "save_lyrics" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                file_hash: String,
                lines: Vec<String>,
            }
            let args: Args = deserialize(payload)?;
            save_lyrics_and_realign(&args.file_hash, args.lines).map_err(ApiError::bad_request)?;
            Ok(Value::Null)
        }
        "provide_lrc" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                file_hash: String,
                lrc_text: String,
                separate_stems: bool,
            }
            let args: Args = deserialize(payload)?;
            app_core::provide_lrc(&args.file_hash, &args.lrc_text, args.separate_stems)
                .map_err(ApiError::bad_request)?;
            Ok(Value::Null)
        }
        "apply_timed_lyrics" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                file_hash: String,
                lrc_text: String,
            }
            let args: Args = deserialize(payload)?;
            app_core::apply_timed_lyrics(&args.file_hash, &args.lrc_text)
                .map_err(ApiError::bad_request)?;
            Ok(Value::Null)
        }
        "align_lrc_lyrics" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                file_hash: String,
                lrc_text: String,
            }
            let args: Args = deserialize(payload)?;
            app_core::align_lrc_lyrics(&args.file_hash, &args.lrc_text)
                .map_err(ApiError::bad_request)?;
            Ok(Value::Null)
        }
        "load_sidecar_lrc" => {
            let args: FileHashArgs = deserialize(payload)?;
            let sidecar = tokio::task::spawn_blocking(move || load_sidecar_lrc(&args.file_hash))
                .await
                .map_err(blocking_task_err)?;
            Ok(serde_json::to_value(sidecar).map_err(serde_err)?)
        }

        // ── Playback ─────────────────────────────────────────────────────
        "load_transcript" => {
            let args: FileHashArgs = deserialize(payload)?;
            app_core::load_transcript(&args.file_hash)
                .map_err(|e| ApiError::internal(e.to_string()))
        }
        "get_audio_paths" => {
            let args: FileHashArgs = deserialize(payload)?;
            Ok(
                serde_json::to_value(app_core::get_audio_paths(&args.file_hash))
                    .map_err(serde_err)?,
            )
        }
        "ensure_mp3_stems" => ensure_mp3_stems_cmd(events, payload),
        "ensure_playable_source_video" => {
            let args: FileHashArgs = deserialize(payload)?;
            let path = app_core::ensure_playable_source_video(&args.file_hash)
                .ok()
                .flatten();
            Ok(serde_json::to_value(path).map_err(serde_err)?)
        }
        "export_song_nge" => {
            #[derive(Deserialize)]
            #[serde(rename_all = "camelCase")]
            struct Args {
                file_hash: String,
                #[serde(default)]
                dest_dir: Option<String>,
            }
            let args: Args = deserialize(payload)?;
            let dest_dir = state
                .runtime
                .resolve_export_directory(args.dest_dir.as_deref().map(Path::new))
                .map_err(ApiError::bad_request)?;
            let path = tokio::task::spawn_blocking(move || {
                app_core::export_song_nge(&args.file_hash, &dest_dir)
            })
            .await
            .map_err(blocking_task_err)?
            .map_err(|error| ApiError::bad_request(error.to_string()))?;
            Ok(Value::String(path.to_string_lossy().into_owned()))
        }
        "fetch_pixabay_videos" => fetch_pixabay_videos_cmd(events, payload),

        // ── Vendor ───────────────────────────────────────────────────────
        "is_ready" => Ok(Value::Bool(app_core::is_ready())),
        "trigger_setup" => vendor::trigger_setup(events, payload),

        _ => Err(CommandError {
            status: 404,
            message: format!("unknown command {name}"),
        }),
    }
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteLyrics {
    lines: Vec<String>,
}

/// Longest link a remote may submit; the body limit bounds the request, this
/// bounds the one field inside it before it is parsed.
const MAX_IMPORT_LINK_CHARS: usize = 2048;

/// Why an import failed, as much as a guest is told. The host's own reason is
/// yt-dlp's stderr, which quotes local paths, so it never leaves the host.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
enum RemoteImportProblem {
    Unavailable,
    Network,
    Failed,
}

fn coarse_import_problem(reason: &str) -> RemoteImportProblem {
    let lower = reason.to_ascii_lowercase();
    if ["private", "unavailable", "removed", "age"]
        .iter()
        .any(|word| lower.contains(word))
    {
        return RemoteImportProblem::Unavailable;
    }
    if ["network", "timed out", "resolve"]
        .iter()
        .any(|word| lower.contains(word))
    {
        return RemoteImportProblem::Network;
    }
    RemoteImportProblem::Failed
}

/// One import as a remote sees it: no job id, submitter, or host failure text.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteImport {
    id: String,
    title: String,
    artist: String,
    duration_secs: f64,
    status: app_core::ImportEntryStatus,
    pct: f64,
    problem: Option<RemoteImportProblem>,
}

impl From<&app_core::ImportQueueRow> for RemoteImport {
    fn from(row: &app_core::ImportQueueRow) -> Self {
        Self {
            id: row.id.clone(),
            title: row.title.clone(),
            artist: row.artist.clone(),
            duration_secs: row.duration_secs,
            status: row.status,
            pct: row.pct,
            problem: row.reason.as_deref().map(coarse_import_problem),
        }
    }
}

/// Read per request so turning the setting off takes effect immediately.
fn require_remote_import() -> Result<(), ApiError> {
    if AppConfig::load().party_import {
        Ok(())
    } else {
        Err(CommandError {
            status: 403,
            message: "importing from a phone is turned off".to_string(),
        })
    }
}

/// Queues one YouTube video. Only the video id survives from the request: the
/// link is parsed, its host checked against the allowlist, and the URL that
/// reaches yt-dlp is rebuilt from the id. Playlists are refused.
async fn submit_remote_import(url: String) -> Result<RemoteImport, ApiError> {
    if url.len() > MAX_IMPORT_LINK_CHARS {
        return Err(ApiError::bad_request("that link is too long"));
    }
    let video_id =
        app_core::video_id_of(&url).map_err(|error| ApiError::bad_request(error.message()))?;

    let row = tokio::task::spawn_blocking(move || {
        let (title, artist) =
            app_core::oembed_title(&video_id).unwrap_or_else(|| (video_id.clone(), String::new()));
        let preview = app_core::ImportPreview {
            is_playlist: false,
            playlist_id: None,
            playlist_title: None,
            entries: vec![app_core::ImportEntry {
                id: video_id,
                title,
                artist,
                duration_secs: 0.0,
            }],
        };
        app_core::submit_import(&preview, app_core::ImportSubmitter::Phone)
    })
    .await
    .map_err(blocking_task_err)?
    .map_err(ApiError::bad_request)?;

    row.first()
        .map(RemoteImport::from)
        .ok_or_else(|| ApiError::bad_request("nothing was queued"))
}

fn serde_err(e: serde_json::Error) -> ApiError {
    ApiError::internal(format!("serialise: {e}"))
}

fn blocking_task_err(error: tokio::task::JoinError) -> ApiError {
    ApiError::internal(format!("blocking command failed: {error}"))
}

fn deserialize<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, ApiError> {
    serde_json::from_value(value).map_err(|e| ApiError::bad_request(format!("invalid args: {e}")))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NameArgs {
    name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileHashArgs {
    file_hash: String,
}

#[derive(Deserialize)]
struct SongTargetArgs {
    target: SongTarget,
}

#[derive(Deserialize)]
struct SongTargetLanguageArgs {
    target: SongTarget,
    #[serde(default)]
    language: Option<String>,
}

#[derive(Deserialize)]
struct SaveConfigArgs {
    config: AppConfig,
}

fn save_config_cmd(events: EventEmitter, payload: Value) -> CmdResult {
    let SaveConfigArgs { mut config } = deserialize(payload)?;
    let current = AppConfig::load();
    let was_auto_analyze = current.auto_analyze();
    config.desktop_window = current.desktop_window;
    config.playback_window = current.playback_window;
    config.save();
    events.0.set_monitor_gain(config.mic_monitor_gain());
    if config.auto_analyze() && !was_auto_analyze {
        let _ = app_core::enqueue(SongTarget::Filter {
            filters: app_core::LibraryMenuFilters::default(),
        });
    }
    serde_json::to_value(config).map_err(serde_err)
}

#[derive(Deserialize)]
struct AddCustomBackgroundUrlArgs {
    name: String,
    url: String,
}

fn add_custom_background_url_cmd(payload: Value) -> CmdResult {
    let args: AddCustomBackgroundUrlArgs = deserialize(payload)?;
    let config =
        app_core::add_custom_background_url(args.name, args.url).map_err(ApiError::bad_request)?;
    serde_json::to_value(config).map_err(serde_err)
}

#[derive(Deserialize)]
struct CustomBackgroundIdArgs {
    id: String,
}

fn remove_custom_background_cmd(payload: Value) -> CmdResult {
    let args: CustomBackgroundIdArgs = deserialize(payload)?;
    let config = app_core::remove_custom_background(&args.id).map_err(ApiError::bad_request)?;
    serde_json::to_value(config).map_err(serde_err)
}

fn resolve_custom_background_path_cmd(payload: Value) -> CmdResult {
    let args: CustomBackgroundIdArgs = deserialize(payload)?;
    let path = app_core::resolve_custom_background_path(&args.id).map_err(ApiError::bad_request)?;
    serde_json::to_value(path).map_err(serde_err)
}

fn load_custom_background_shader_cmd(payload: Value) -> CmdResult {
    let args: CustomBackgroundIdArgs = deserialize(payload)?;
    let source =
        app_core::load_custom_background_shader(&args.id).map_err(ApiError::bad_request)?;
    serde_json::to_value(source).map_err(serde_err)
}

fn shift_key_cmd(events: EventEmitter, payload: Value) -> CmdResult {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Args {
        file_hash: String,
        key: String,
        pitch_ratio: f64,
        key_offset: i32,
    }
    let args: Args = deserialize(payload)?;
    std::thread::spawn(move || {
        let payload =
            shift_key_done_payload(args.file_hash, args.key, args.pitch_ratio, args.key_offset);
        events.emit("shift-key-done", &payload);
    });
    Ok(Value::Null)
}

fn shift_tempo_cmd(events: EventEmitter, payload: Value) -> CmdResult {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Args {
        file_hash: String,
        tempo: f64,
    }
    let args: Args = deserialize(payload)?;
    std::thread::spawn(move || {
        let payload = shift_tempo_done_payload(args.file_hash, args.tempo);
        events.emit("shift-tempo-done", &payload);
    });
    Ok(Value::Null)
}

fn ensure_mp3_stems_cmd(events: EventEmitter, payload: Value) -> CmdResult {
    let args: FileHashArgs = deserialize(payload)?;
    std::thread::spawn(move || {
        events.emit(
            "stems-ready",
            &ensure_mp3_stems_ready_payload(args.file_hash),
        );
    });
    Ok(Value::Null)
}

fn fetch_pixabay_videos_cmd(events: EventEmitter, payload: Value) -> CmdResult {
    #[derive(Deserialize)]
    struct Args {
        flavor: String,
    }
    let args: Args = deserialize(payload)?;
    let cached = app_core::get_cached_pixabay_videos(&args.flavor);

    let flavor_for_thread = args.flavor.clone();
    let events_clone = events.clone();
    std::thread::spawn(move || {
        let flavor_for_emit = flavor_for_thread.clone();
        app_core::download_pixabay_videos(&flavor_for_thread, move |path, evicted_path| {
            events_clone.emit(
                "pixabay-video-downloaded",
                &PixabayVideoDownloaded::new(flavor_for_emit.clone(), path, evicted_path),
            );
        });
    });

    Ok(json!(cached))
}
