//! LAN address discovery for the QR code the phone scans.

use std::net::{IpAddr, UdpSocket};

/// The address this machine would use to reach the wider network, found by
/// asking the routing table with an unconnected UDP socket. No packet is
/// sent; `192.0.2.1` is the reserved TEST-NET-1 documentation address, so the
/// lookup never depends on a reachable peer. Returns `None` when there is no
/// usable route (offline, loopback-only).
pub fn lan_ip() -> Option<IpAddr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:80").ok()?;
    let ip = socket.local_addr().ok()?.ip();
    if ip.is_loopback() || ip.is_unspecified() {
        return None;
    }
    Some(ip)
}

/// The page a phone opens, or `None` when the LAN address is unknown.
pub fn lan_url(port: u16) -> Option<String> {
    lan_ip().map(|ip| format!("http://{ip}:{port}/remote"))
}
