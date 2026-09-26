//! The standalone listener: a router with exactly two things on it — the
//! relay WebSocket and the embedded SPA — plus the bind/stop lifecycle the
//! desktop app drives.
//!
//! Nothing else is routed here on purpose. The desktop listener is reachable
//! from the LAN with no authentication, so its whole surface is "relay frames"
//! and "serve the bundle". No `app-core` operation is exposed.

use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    body::Body,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    http::{header, HeaderValue, Method, Request, Response, StatusCode, Uri},
    response::IntoResponse,
    routing::any,
    Router,
};
use futures_util::{sink::SinkExt, stream::StreamExt};
use rust_embed::RustEmbed;
use tokio::sync::oneshot;

use crate::party::PartyState;
use crate::relay::Relay;

/// The same frontend build the self-hosted server embeds. The phone loads
/// `/remote` from it; the SPA fallback routes the rest.
#[derive(RustEmbed)]
#[folder = "../dist/"]
struct StaticAssets;

/// A running listener. Dropping it — or calling [`RemoteListener::stop`] —
/// closes the relay's connections and releases the port.
pub struct RemoteListener {
    port: u16,
    shutdown: Option<oneshot::Sender<()>>,
}

impl RemoteListener {
    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn stop(self) {}
}

impl Drop for RemoteListener {
    fn drop(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            // An error here means the serve task already exited.
            let _ = shutdown.send(());
        }
    }
}

/// Routes for the relay listener: the WebSocket, the library and queue
/// surface, and the embedded bundle.
pub fn router(relay: Arc<Relay>, party: PartyState) -> Router {
    Router::new()
        .route("/ws", any(handle_upgrade))
        .fallback(handle_static)
        .with_state(relay)
        .merge(crate::party::router(party))
}

/// Bind `addr` and start serving. Pass port 0 for an ephemeral port and read
/// the chosen one back from the returned handle.
pub async fn serve(addr: SocketAddr, party: PartyState) -> Result<RemoteListener, String> {
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("failed to bind remote listener on {addr}: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("remote listener has no local address: {e}"))?
        .port();

    let relay = Arc::new(Relay::new());
    let app = router(relay.clone(), party);
    let (tx, rx) = oneshot::channel();

    tokio::spawn(async move {
        let server =
            axum::serve(listener, app.into_make_service()).with_graceful_shutdown(async move {
                // A dropped sender means the handle went away, which is also
                // a stop request.
                let _ = rx.await;
                relay.close().await;
            });
        if let Err(e) = server.await {
            tracing::warn!("remote listener stopped with error: {e}");
        }
    });

    tracing::info!(port, "remote control listener started");
    Ok(RemoteListener {
        port,
        shutdown: Some(tx),
    })
}

async fn handle_upgrade(
    State(relay): State<Arc<Relay>>,
    upgrade: WebSocketUpgrade,
) -> impl IntoResponse {
    upgrade.on_upgrade(move |socket| run_socket(relay, socket))
}

/// One WebSocket, one relay participant.
async fn run_socket(relay: Arc<Relay>, socket: WebSocket) {
    let client = relay.connect().await;
    let id = client.id;
    let mut outbound = client.outbound;
    let (mut sender, mut receiver) = socket.split();

    loop {
        tokio::select! {
            frame = outbound.recv() => {
                let Some(text) = frame else { break };
                if sender.send(Message::Text(text)).await.is_err() {
                    break;
                }
            }
            message = receiver.next() => {
                let Some(Ok(message)) = message else { break };
                match message {
                    Message::Text(text) => relay.handle_text(id, &text).await,
                    Message::Close(_) => break,
                    _ => {}
                }
            }
        }
    }

    relay.disconnect(id).await;
}

/// SPA-aware static handler: try the requested path, then `index.html`, so
/// `/remote` resolves to the bundle's client-side route.
async fn handle_static(request: Request<Body>) -> Response<Body> {
    if request.method() != Method::GET && request.method() != Method::HEAD {
        return response(StatusCode::METHOD_NOT_ALLOWED, Body::empty());
    }
    serve_path(request.uri()).unwrap_or_else(serve_index)
}

fn serve_path(uri: &Uri) -> Option<Response<Body>> {
    let path = uri.path().trim_start_matches('/');
    if path.is_empty() {
        return None;
    }
    let asset = StaticAssets::get(path)?;
    Some(asset_to_response(path, asset))
}

fn serve_index() -> Response<Body> {
    match StaticAssets::get("index.html") {
        Some(asset) => asset_to_response("index.html", asset),
        None => response(
            StatusCode::NOT_FOUND,
            Body::from("Frontend bundle missing. Did you run `pnpm build`?"),
        ),
    }
}

fn asset_to_response(path: &str, asset: rust_embed::EmbeddedFile) -> Response<Body> {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mut response = response(StatusCode::OK, Body::from(asset.data.to_vec()));
    if let Ok(content_type) = HeaderValue::from_bytes(mime.as_ref().as_bytes()) {
        response
            .headers_mut()
            .insert(header::CONTENT_TYPE, content_type);
    }
    if path.starts_with("assets/") {
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        );
    }
    response
}

fn response(status: StatusCode, body: Body) -> Response<Body> {
    let mut response = Response::new(body);
    *response.status_mut() = status;
    response
}
