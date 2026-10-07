use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use futures_util::{sink::SinkExt, stream::StreamExt};

use crate::state::AppState;

pub(crate) async fn handle_upgrade(
    State(state): State<AppState>,
    upgrade: WebSocketUpgrade,
) -> impl IntoResponse {
    upgrade.on_upgrade(move |socket| run(state, socket))
}

/// One socket carries two streams to the client: the app event bus (the web
/// stand-in for `AppHandle::emit`) and this connection's remote-control
/// frames. Inbound text is relay traffic, which the shared `remote` crate
/// validates and routes — the server adds no frame handling of its own.
async fn run(state: AppState, socket: WebSocket) {
    let client = state.remote.connect().await;
    let client_id = client.id;
    let mut outbound = client.outbound;
    let mut events = state.events.subscribe();
    let (mut sender, mut receiver) = socket.split();

    tracing::debug!(%client_id, "ws connected");

    loop {
        tokio::select! {
            frame = outbound.recv() => {
                let Some(text) = frame else { break };
                if sender.send(Message::Text(text)).await.is_err() {
                    break;
                }
            }
            event = events.recv() => {
                match event {
                    Ok(envelope) => {
                        let Ok(text) = serde_json::to_string(&envelope) else {
                            continue;
                        };
                        if sender.send(Message::Text(text)).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        // Slow consumer: drop the backlog and keep the socket
                        // alive rather than disconnecting.
                        tracing::warn!(%client_id, %skipped, "ws lagged behind broadcast");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            message = receiver.next() => {
                let Some(Ok(message)) = message else { break };
                match message {
                    Message::Text(text) => state.remote.handle_text(client_id, &text).await,
                    Message::Close(_) => break,
                    _ => {}
                }
            }
        }
    }

    state.remote.disconnect(client_id).await;
    tracing::debug!(%client_id, "ws disconnected");
}
