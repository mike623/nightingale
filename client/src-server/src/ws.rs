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

/// The web stand-in for `AppHandle::emit`: every app event goes out on the
/// socket. Clients act through `/api/cmd`, so inbound frames are ignored apart
/// from close.
async fn run(state: AppState, socket: WebSocket) {
    let mut events = state.events.subscribe();
    let (mut sender, mut receiver) = socket.split();

    tracing::debug!("ws connected");

    loop {
        tokio::select! {
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
                        tracing::warn!(%skipped, "ws lagged behind broadcast");
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            message = receiver.next() => {
                match message {
                    Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                    Some(Ok(_)) => {}
                }
            }
        }
    }

    tracing::debug!("ws disconnected");
}
