//! Remote control relay shared by the desktop and self-hosted targets.
//!
//! A phone on the LAN opens the mobile page and steers playback that is
//! happening somewhere else: audio always plays in the host page (browser tab
//! or Tauri webview). This crate is the thing in the middle. It fans frames
//! between the host and the phones and remembers the last snapshot for late
//! joiners. Every phone may steer playback; the relay does not know what a
//! song is.
//!
//! Browsing the library and shaping the queue is a different surface — see
//! [`party`], the small HTTP both targets serve beside the relay.
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

#[cfg(feature = "party")]
pub mod party;

pub use net::{lan_ip, lan_url};
pub use protocol::{ClientFrame, DenyReason, RemoteCommand, RemoteSnapshot, RemoteSong, Role};
pub use relay::{ClientId, Relay, RemoteClient};
