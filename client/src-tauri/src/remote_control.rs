//! Desktop remote control: an opt-in LAN listener that relays frames between
//! this webview (the host, where audio plays) and phones on the network.
//!
//! The listener is never started at boot. The frontend calls `remote_start`
//! when the user turns the feature on, and `remote_stop` releases the port.

use std::net::{Ipv4Addr, SocketAddr};

use remote::listener::RemoteListener;
use serde::Serialize;
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

#[tauri::command]
pub(crate) async fn remote_start(
    control: tauri::State<'_, RemoteControl>,
) -> Result<RemoteStatus, String> {
    let mut guard = control.listener.lock().await;
    if let Some(listener) = guard.as_ref() {
        return Ok(RemoteStatus::running(listener.port()));
    }

    // Port 0: the OS picks a free port, and phones learn it from the QR code.
    let addr = SocketAddr::from((Ipv4Addr::UNSPECIFIED, 0));
    let listener = remote::listener::serve(addr).await?;
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
