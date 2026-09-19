use std::sync::Arc;

use app_core::{PlaybackQueue, PlaybackSessionStore};
use remote::Relay;

use crate::events::EventBus;

#[derive(Clone)]
pub(crate) struct AppState {
    pub events: Arc<EventBus>,
    pub remote: Arc<Relay>,
    pub playback_queue: Arc<PlaybackQueue>,
    pub playback_sessions: Arc<PlaybackSessionStore>,
    pub data_path_pinned: bool,
    pub library_pinned: bool,
    /// The port the HTTP/WS listener actually bound, used to build the remote
    /// control URL handed to phones.
    pub bind_port: u16,
}

impl AppState {
    pub(crate) fn new(data_path_pinned: bool, library_pinned: bool, bind_port: u16) -> Self {
        Self {
            events: Arc::new(EventBus::new()),
            remote: Arc::new(Relay::new()),
            playback_queue: Arc::new(PlaybackQueue::default()),
            playback_sessions: Arc::new(PlaybackSessionStore::default()),
            data_path_pinned,
            library_pinned,
            bind_port,
        }
    }
}
