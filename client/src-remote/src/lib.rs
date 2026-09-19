//! Remote control relay shared by the desktop and self-hosted targets.
//!
//! A phone on the LAN opens the mobile page and steers playback that is
//! happening somewhere else: audio always plays in the host page (browser tab
//! or Tauri webview). This crate is the thing in the middle. It fans frames
//! between the host and the phones, remembers the last snapshot for late
//! joiners, and arbitrates which phone is allowed to send commands. It does
//! not know what a song is.
//!
//! Two consumers, one implementation:
//!
//!  - the self-hosted server multiplexes relay frames onto its existing `/ws`
//!    route and serves the bundle from its own static handler, so it uses
//!    [`Relay`] alone;
//!  - the desktop app has no HTTP server of its own, so it enables the
//!    `listener` feature and gets [`listener::serve`] plus the embedded SPA.

mod net;
mod protocol;
mod relay;

#[cfg(feature = "listener")]
pub mod listener;

pub use net::{lan_ip, lan_url};
pub use protocol::{ClientFrame, DenyReason, RemoteCommand, RemoteSnapshot, RemoteSong, Role};
pub use relay::{ClientId, Relay, RemoteClient};
