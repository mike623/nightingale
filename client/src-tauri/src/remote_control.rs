//! Desktop remote control: an opt-in LAN listener that relays frames between
//! this webview (the host, where audio plays) and phones on the network.
//!
//! The listener is never started at boot. The frontend calls `remote_start`
//! when the user turns the feature on, and `remote_stop` releases the port.

use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;

/// The port the listener binds. Fixed rather than ephemeral so the address a
/// phone bookmarked keeps working across restarts; an OS-assigned port changed
/// every launch and silently invalidated it. Chosen from the dynamic range to
/// stay clear of registered services. A clash with something else on this
/// machine surfaces as a bind error when remote control is switched on.
const REMOTE_PORT: u16 = 51737;

use app_core::{PlaybackQueue, PlaybackQueueEntry};
use remote::listener::RemoteListener;
use remote::party::PartyState;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub(crate) struct RemoteStatus {
    pub running: bool,
    pub port: Option<u16>,
    /// What the QR code encodes for a phone on the same network.
    pub lan_url: Option<String>,
    /// Where this webview connects as the host — over loopback, because the
    /// host page and the listener are the same process.
    pub ws_url: Option<String>,
}

impl RemoteStatus {
    fn stopped() -> Self {
        Self {
            running: false,
            port: None,
            lan_url: None,
            ws_url: None,
        }
    }

    fn running(port: u16) -> Self {
        Self {
            running: true,
            port: Some(port),
            lan_url: remote::lan_url(port),
            ws_url: Some(format!("ws://127.0.0.1:{port}/ws")),
        }
    }
}

#[derive(Default)]
pub(crate) struct RemoteControl {
    listener: Mutex<Option<RemoteListener>>,
}

/// The listener shares the queue the desktop already owns, and announces a
/// phone's change on the same event the desktop's own queue calls emit, so
/// the library screen and the phones never disagree about what is queued.
fn party_state(app: &AppHandle, queue: Arc<PlaybackQueue>) -> PartyState {
    let app = app.clone();

    PartyState::new(queue, move |entries: &[PlaybackQueueEntry]| {
        if let Err(error) = app.emit("playback-queue-changed", entries) {
            tracing::warn!("failed to announce a queue change from the remote: {error}");
        }
    })
}

#[tauri::command]
pub(crate) async fn remote_start(
    app: AppHandle,
    queue: tauri::State<'_, Arc<PlaybackQueue>>,
    control: tauri::State<'_, RemoteControl>,
) -> Result<RemoteStatus, String> {
    let mut guard = control.listener.lock().await;
    if let Some(listener) = guard.as_ref() {
        return Ok(RemoteStatus::running(listener.port()));
    }

    let addr = SocketAddr::from((Ipv4Addr::UNSPECIFIED, REMOTE_PORT));
    let listener = remote::listener::serve(addr, party_state(&app, queue.inner().clone())).await?;
    let status = RemoteStatus::running(listener.port());
    *guard = Some(listener);
    Ok(status)
}

#[tauri::command]
pub(crate) async fn remote_stop(
    control: tauri::State<'_, RemoteControl>,
) -> Result<RemoteStatus, String> {
    let mut guard = control.listener.lock().await;
    if let Some(listener) = guard.take() {
        listener.stop();
    }
    Ok(RemoteStatus::stopped())
}

#[tauri::command]
pub(crate) async fn remote_status(
    control: tauri::State<'_, RemoteControl>,
) -> Result<RemoteStatus, String> {
    let guard = control.listener.lock().await;
    Ok(match guard.as_ref() {
        Some(listener) => RemoteStatus::running(listener.port()),
        None => RemoteStatus::stopped(),
    })
}
