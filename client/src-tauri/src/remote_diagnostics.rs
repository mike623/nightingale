//! What the desktop can establish about the phone queue link without leaving
//! the machine: whether the listener is up, and whether its loopback and LAN
//! addresses actually answer from here.

use std::net::{Ipv4Addr, SocketAddr};
use std::time::Duration;

use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::time::timeout;
use ts_rs::TS;

/// The listener is on this machine, so a healthy answer is immediate; anything
/// slower is a firewall or a stale address, not a slow server.
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);

/// Served without the pairing token, so a probe needs no secret and proves the
/// listener is ours rather than whatever else might hold the port.
const PROBE_PATH: &str = "/favicon.png";

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
pub(crate) struct RemoteStatus {
    pub running: bool,
    pub port: Option<u16>,
}

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

/// A refused connection, a connection that answers nothing, and an answer that
/// is not ours are three faults with three fixes, so each is reported apart.
async fn probe(address: SocketAddr) -> RemoteProbe {
    let attempt = timeout(PROBE_TIMEOUT, async {
        let mut stream = TcpStream::connect(address).await?;
        stream
            .write_all(
                format!(
                    "GET {PROBE_PATH} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n\r\n"
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

pub(crate) async fn diagnose(running: bool) -> RemoteDiagnostics {
    let port = app_core::REMOTE_PORT;
    if !running {
        return RemoteDiagnostics {
            status: RemoteStatus {
                running: false,
                port: None,
            },
            loopback: missing_probe("the listener is not running"),
            lan: missing_probe("the listener is not running"),
        };
    }

    let loopback = probe(SocketAddr::from((Ipv4Addr::LOCALHOST, port))).await;
    let lan = match app_core::lan_ip() {
        Some(ip) => probe(SocketAddr::new(ip, port)).await,
        None => missing_probe("this machine has no address on a local network"),
    };

    RemoteDiagnostics {
        status: RemoteStatus {
            running: true,
            port: Some(port),
        },
        loopback,
        lan,
    }
}
