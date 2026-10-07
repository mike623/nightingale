//! What the room has already sung, and the next-song draw that uses it.
//!
//! A karaoke library grows faster than it gets sung, and a uniform draw keeps
//! landing on the same handful of songs while others are never heard. Every
//! finished run is recorded here, and the draw leans towards the songs with
//! the least history so the pool levels out over an evening.
//!
//! Counters are global rather than per profile — see `library_db::play_stats`
//! for why — and storage details stay behind that module.

use crate::library_db::{PlayOutcome, pick_weighted_analyzed_song, record_play};
use crate::song::Song;

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Records how one playback run ended.
///
/// `sung` is true only when the run produced a score above zero. A run that
/// was left early, or that played to the end without scoring (no microphone,
/// or nobody sang), counts as a skip — both mean the song did not get its
/// turn, and both make it likelier to come round again.
pub fn record_song_play(file_hash: &str, sung: bool) -> Result<(), String> {
    if file_hash.is_empty() {
        return Err("cannot record a play for an empty song id".to_string());
    }

    let outcome = if sung {
        PlayOutcome::Sung
    } else {
        PlayOutcome::Skipped
    };

    record_play(file_hash, outcome, now_secs())
        .map_err(|e| format!("failed recording song play: {e}"))
}

/// Draws the next analyzed song, biased towards the least-sung ones.
///
/// `exclude_file_hash` keeps the song that just played out of its own draw.
/// Returns `None` when the library holds no other analyzed song.
pub fn pick_next_song(exclude_file_hash: Option<&str>) -> Result<Option<Song>, String> {
    let roll: f64 = rand::random();

    pick_weighted_analyzed_song(exclude_file_hash, roll)
        .map_err(|e| format!("failed picking the next song: {e}"))
}
