//! Desktop remote control: an opt-in LAN listener that relays frames between
//! this webview (the host, where audio plays) and phones on the network.
//!
//! The listener is never started at boot. The frontend calls `remote_start`
//! when the user turns the feature on, and `remote_stop` releases the port.

use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

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
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::Mutex;
use tokio::time::timeout;
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
    // The setting is the switch, so nothing may bind the network port while it
    // is off — not a stale page, and not a socket retrying its way back after
    // the operator turned remote control off.
    if !app_core::AppConfig::load().remote_control {
        return Err("Remote control is turned off".to_string());
    }

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

/// How long a self-check waits before calling an address unreachable. The
/// listener is on this machine, so a healthy answer is immediate; anything
/// slower is a firewall or a stale address, not a slow server.
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

/// One address the host tried to reach its own listener on.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub(crate) struct RemoteProbe {
    /// `null` when there was no address to try.
    pub address: Option<String>,
    pub ok: bool,
    /// The answer's status line, or why the attempt failed.
    pub detail: String,
}

/// What the desktop can establish about remote control without leaving the
/// machine: whether the listener is up, what address the QR code hands out,
/// and whether that address actually answers from here.
///
/// A LAN address that fails here is the address itself — a lease that moved,
/// or an interface that is no longer the route out. A LAN address that
/// answers here but not from a phone is the network between them: a firewall,
/// client isolation on the access point, or a different subnet.
#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub(crate) struct RemoteDiagnostics {
    pub status: RemoteStatus,
    pub loopback: RemoteProbe,
    pub lan: RemoteProbe,
}

fn missing_probe(reason: &str) -> RemoteProbe {
    RemoteProbe {
        address: None,
        ok: false,
        detail: reason.to_string(),
    }
}

/// Ask the listener for the queue over a plain socket and report what came
/// back. Each stage is reported separately: a refused connection, a
/// connection that answers nothing, and an answer that is not a listener of
/// ours are three different faults with three different fixes.
///
/// The request is fixed text, so anything that goes wrong here is the
/// transport's.
async fn probe(address: SocketAddr) -> RemoteProbe {
    let attempt = timeout(PROBE_TIMEOUT, async {
        let mut stream = TcpStream::connect(address).await?;
        stream
            .write_all(
                format!(
                    "GET /party/queue HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n"
                )
                .as_bytes(),
            )
            .await?;

        let mut response = [0_u8; 64];
        let read = stream.read(&mut response).await?;
        Ok::<String, std::io::Error>(String::from_utf8_lossy(&response[..read]).to_string())
    })
    .await;

    let (ok, detail) = match attempt {
        Ok(Ok(response)) if response.is_empty() => (
            false,
            "connected, then the connection closed without an answer".to_string(),
        ),
        Ok(Ok(response)) => {
            let status = response
                .lines()
                .next()
                .unwrap_or_default()
                .trim()
                .to_string();

            if status.contains("200") {
                (true, status)
            } else {
                (false, format!("answered {status}"))
            }
        }
        Ok(Err(error)) => (false, error.to_string()),
        Err(_) => (false, "no answer within two seconds".to_string()),
    };

    RemoteProbe {
        address: Some(address.to_string()),
        ok,
        detail,
    }
}

#[tauri::command]
pub(crate) async fn remote_diagnostics(
    control: tauri::State<'_, RemoteControl>,
) -> Result<RemoteDiagnostics, String> {
    let status = {
        let guard = control.listener.lock().await;
        match guard.as_ref() {
            Some(listener) => RemoteStatus::running(listener.port()),
            None => RemoteStatus::stopped(),
        }
    };

    let Some(port) = status.port else {
        return Ok(RemoteDiagnostics {
            loopback: missing_probe("the listener is not running"),
            lan: missing_probe("the listener is not running"),
            status,
        });
    };

    let loopback = probe(SocketAddr::from((Ipv4Addr::LOCALHOST, port))).await;
    let lan = match remote::lan_ip() {
        Some(ip) => probe(SocketAddr::new(ip, port)).await,
        None => missing_probe("this machine has no address on a local network"),
    };

    Ok(RemoteDiagnostics {
        status,
        loopback,
        lan,
    })
}
