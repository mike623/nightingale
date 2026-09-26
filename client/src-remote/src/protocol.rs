//! Wire types for the remote-control relay.
//!
//! Frames are JSON text. Inbound frames are flat and tagged by `type`, the
//! same shape the self-hosted WebSocket already speaks. Outbound frames reuse
//! the `{type, payload}` envelope the frontend runtime shim routes on.

use serde::{Deserialize, Serialize};

/// Largest lyric shift one command may ask for. A phone's buttons step by at
/// most a second; the bound keeps a hand-written frame from throwing the
/// lyrics out of the song in a single press.
const MAX_SHIFT_STEP_MS: i64 = 5_000;

/// Which side of the relay a connection is. The host plays the audio; remotes
/// only send commands. Every remote may send them.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Host,
    Remote,
}

/// What the phone renders. The relay never interprets these fields; it stores
/// the latest one so a late joiner has something to draw immediately.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RemoteSnapshot {
    pub song: Option<RemoteSong>,
    pub paused: bool,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub guide_volume: f32,
    pub guide_available: bool,
    pub lyrics_hidden: bool,
    pub theme_index: u32,
    pub theme_name: String,
    pub flavor_name: String,
    pub score: u32,
    pub mic_enabled: bool,
    pub mic_monitor_enabled: bool,
    pub mic_name: String,
    pub can_skip_intro: bool,
    pub can_skip_outro: bool,
    /// How far the host has pushed the lyric display from the song's own
    /// timing, in milliseconds; positive shows a line later. Session-only, so
    /// it is published rather than stored.
    #[serde(default)]
    pub lyric_offset_ms: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct RemoteSong {
    pub file_hash: String,
    pub title: String,
    pub artist: String,
}

/// An instruction the host page performs. The relay forwards it verbatim; it
/// never maps a command onto an `app-core` operation itself.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum RemoteCommand {
    Pause,
    Resume,
    TogglePause,
    Restart,
    Next,
    Exit,
    Seek { position_ms: u64 },
    SetGuideVolume { volume: f32 },
    ToggleGuide,
    CycleTheme,
    CycleFlavor,
    ToggleLyrics,
    ToggleMic,
    CycleMic,
    ToggleMicMonitor,
    SkipIntro,
    SkipOutro,
    ShiftLyrics { delta_ms: i64 },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum ClientFrame {
    #[serde(rename = "remote.hello")]
    Hello { role: Role },
    #[serde(rename = "remote.state")]
    State(RemoteSnapshot),
    #[serde(rename = "remote.command")]
    Command(RemoteCommand),
}

/// Why a command was dropped. Closed set: the phone UI branches on it.
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DenyReason {
    NoHost,
}

#[derive(Debug, Serialize)]
pub(crate) struct SessionFrame {
    pub you: u64,
    pub host_connected: bool,
}

#[derive(Debug, Serialize)]
pub(crate) struct DenyFrame {
    pub reason: DenyReason,
}

/// Mirrors the `{type, payload}` envelope the Tauri target emits, so both
/// transports deliver remote frames through the same frontend listener.
#[derive(Debug, Serialize)]
pub(crate) struct Envelope<'a, T> {
    pub r#type: &'a str,
    pub payload: T,
}

impl RemoteSnapshot {
    /// Snapshots arrive from the LAN, so the one float on them is checked
    /// before it reaches a UI that would render `NaN`.
    pub(crate) fn sanitized(mut self) -> Option<Self> {
        if !self.guide_volume.is_finite() {
            return None;
        }
        self.guide_volume = self.guide_volume.clamp(0.0, 1.0);
        Some(self)
    }
}

impl RemoteCommand {
    pub(crate) fn sanitized(self) -> Option<Self> {
        match self {
            Self::SetGuideVolume { volume } if !volume.is_finite() => None,
            Self::SetGuideVolume { volume } => Some(Self::SetGuideVolume {
                volume: volume.clamp(0.0, 1.0),
            }),
            Self::ShiftLyrics { delta_ms } => Some(Self::ShiftLyrics {
                delta_ms: delta_ms.clamp(-MAX_SHIFT_STEP_MS, MAX_SHIFT_STEP_MS),
            }),
            other => Some(other),
        }
    }
}
