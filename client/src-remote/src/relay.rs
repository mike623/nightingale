//! The relay itself: a fan-out table between the host page and the phones.
//!
//! Every phone may steer playback. A karaoke room is a group of people around
//! one screen, so the relay does not decide whose turn it is; the only thing
//! it refuses is a command with no host to perform it.
//!
//! The relay is deliberately dumb. It never touches the library, the player,
//! or any `app-core` operation — it moves frames between the host page and
//! the phones and remembers the last snapshot for late joiners. That bounded
//! surface is what makes an unauthenticated LAN listener acceptable.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use tokio::sync::{mpsc, Mutex};

use crate::protocol::{
    ClientFrame, DenyFrame, DenyReason, Envelope, RemoteCommand, RemoteSnapshot, Role, SessionFrame,
};

/// Identifies one WebSocket connection for the lifetime of that socket.
pub type ClientId = u64;

/// Frames larger than this are dropped unread. A snapshot is a few hundred
/// bytes; anything near the limit is not this protocol.
const MAX_FRAME_BYTES: usize = 8 * 1024;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// A registered connection: its id, and the stream of text frames the socket
/// task must forward to the client.
pub struct RemoteClient {
    pub id: ClientId,
    pub outbound: mpsc::UnboundedReceiver<String>,
}

#[derive(Default)]
struct RelayState {
    clients: HashMap<ClientId, mpsc::UnboundedSender<String>>,
    host: Option<ClientId>,
    snapshot: Option<RemoteSnapshot>,
}

/// Shared relay state. One instance serves every connection on a listener.
#[derive(Default)]
pub struct Relay {
    state: Mutex<RelayState>,
}

impl Relay {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a connection and prime it with the session and the stored
    /// snapshot, so a phone that joins mid-song renders without waiting for
    /// the host's next update.
    pub async fn connect(&self) -> RemoteClient {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let (tx, outbound) = mpsc::unbounded_channel();

        let mut state = self.state.lock().await;
        state.clients.insert(id, tx);
        send_session(&state, id);
        send_state(&state, id);
        drop(state);

        tracing::debug!(client = id, "remote client connected");
        RemoteClient { id, outbound }
    }

    /// Release everything the connection owned. A departing host also clears
    /// the snapshot: a paused-forever screenshot of a session that no longer
    /// exists is worse than an empty one.
    pub async fn disconnect(&self, id: ClientId) {
        let mut state = self.state.lock().await;
        state.clients.remove(&id);

        if state.host == Some(id) {
            state.host = None;
            state.snapshot = None;
            broadcast_state(&state);
        }
        broadcast_session(&state);
        drop(state);

        tracing::debug!(client = id, "remote client disconnected");
    }

    /// Drop every outbound channel. Each socket task sees its stream end and
    /// closes, which is how a stopping listener releases its connections
    /// instead of waiting for phones to hang up.
    pub async fn close(&self) {
        let mut state = self.state.lock().await;
        state.clients.clear();
        state.host = None;
        state.snapshot = None;
    }

    /// Validate and route one inbound text frame.
    pub async fn handle_text(&self, id: ClientId, raw: &str) {
        if raw.len() > MAX_FRAME_BYTES {
            tracing::trace!(client = id, bytes = raw.len(), "remote frame too large");
            return;
        }

        let Ok(frame) = serde_json::from_str::<ClientFrame>(raw) else {
            // Frames can carry song titles and paths, so only the shape is
            // reported, never the body.
            tracing::trace!(client = id, "dropping malformed remote frame");
            return;
        };

        match frame {
            ClientFrame::Hello { role } => self.on_hello(id, role).await,
            ClientFrame::State(snapshot) => self.on_state(id, snapshot).await,
            ClientFrame::Command(command) => self.on_command(id, command).await,
        }
    }

    /// Only a host announcement changes anything a client renders: a phone
    /// saying hello is already registered and has had its session frame.
    async fn on_hello(&self, id: ClientId, role: Role) {
        if matches!(role, Role::Remote) {
            return;
        }

        let mut state = self.state.lock().await;
        state.host = Some(id);
        broadcast_session(&state);
    }

    async fn on_state(&self, id: ClientId, snapshot: RemoteSnapshot) {
        let Some(snapshot) = snapshot.sanitized() else {
            tracing::trace!(client = id, "dropping remote snapshot with invalid volume");
            return;
        };

        let mut state = self.state.lock().await;
        if state.host != Some(id) {
            return;
        }
        state.snapshot = Some(snapshot);
        broadcast_except(&state, id, "remote.state", &state.snapshot);
    }

    async fn on_command(&self, id: ClientId, command: RemoteCommand) {
        let Some(command) = command.sanitized() else {
            tracing::trace!(client = id, "dropping remote command with invalid value");
            return;
        };

        let state = self.state.lock().await;
        let Some(host) = state.host else {
            send(&state, id, "remote.deny", &deny(DenyReason::NoHost));
            return;
        };
        send(&state, host, "remote.command", &command);
    }
}

fn deny(reason: DenyReason) -> DenyFrame {
    DenyFrame { reason }
}

fn send<T: Serialize>(state: &RelayState, id: ClientId, name: &str, payload: &T) {
    let Some(tx) = state.clients.get(&id) else {
        return;
    };
    let envelope = Envelope {
        r#type: name,
        payload,
    };
    match serde_json::to_string(&envelope) {
        // A closed channel only means the socket task already exited.
        Ok(text) => {
            let _ = tx.send(text);
        }
        Err(e) => tracing::warn!("failed to serialise {name} frame: {e}"),
    }
}

fn broadcast_except<T: Serialize>(state: &RelayState, skip: ClientId, name: &str, payload: &T) {
    for id in state.clients.keys() {
        if *id != skip {
            send(state, *id, name, payload);
        }
    }
}

/// `remote.session` carries the recipient's own id, so it is rendered per
/// client rather than fanned out as one blob.
fn send_session(state: &RelayState, id: ClientId) {
    send(
        state,
        id,
        "remote.session",
        &SessionFrame {
            you: id,
            host_connected: state.host.is_some(),
        },
    );
}

fn broadcast_session(state: &RelayState) {
    for id in state.clients.keys() {
        send_session(state, *id);
    }
}

fn send_state(state: &RelayState, id: ClientId) {
    send(state, id, "remote.state", &state.snapshot);
}

fn broadcast_state(state: &RelayState) {
    for id in state.clients.keys() {
        send_state(state, *id);
    }
}
