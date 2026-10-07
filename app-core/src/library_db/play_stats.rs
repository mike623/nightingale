//! Per-song play history and the weighted random draw built on it.
//!
//! The counters live in their own table keyed by `file_hash` with no foreign
//! key to `songs`, because a rescan clears `songs` wholesale — history has to
//! outlive that, and a song that leaves and comes back keeps the weight it
//! earned. Rows for songs that never return are a few bytes each and are left
//! alone rather than swept on a guess.
//!
//! Counters are global, not per profile: the point is to level out which songs
//! the room has already heard, which is a property of the library and not of
//! whoever happens to be signed in. Scores stay per profile in `ProfileStore`.

use rusqlite::{OptionalExtension, params};

use crate::song::Song;

use super::connection::with_conn;
use super::songs::load_song_by_hash;

/// How much one skip counts against a song relative to one sung run. A skip
/// usually means "not right now" rather than "never", so it weighs less.
const SKIP_WEIGHT: f64 = 0.5;

/// How a finished playback run is counted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PlayOutcome {
    /// The run produced a score above zero: somebody actually sang it.
    Sung,
    /// Everything else — left early, or played through without scoring.
    Skipped,
}

pub(crate) fn record_play(
    file_hash: &str,
    outcome: PlayOutcome,
    played_at: u64,
) -> rusqlite::Result<()> {
    let (sung, skipped) = match outcome {
        PlayOutcome::Sung => (1, 0),
        PlayOutcome::Skipped => (0, 1),
    };

    with_conn(|c| {
        c.execute(
            "INSERT INTO song_play_stats (file_hash, sung_count, skip_count, last_played_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(file_hash) DO UPDATE SET
                 sung_count = sung_count + excluded.sung_count,
                 skip_count = skip_count + excluded.skip_count,
                 last_played_at = excluded.last_played_at",
            params![file_hash, sung, skipped, played_at as i64],
        )?;
        Ok(())
    })
}

/// Carry a song's play history onto a new `file_hash` after its bytes were
/// replaced by an equivalent file. Counters belong to the song, not to the
/// copy of it on disk, so a re-download must not reset its weight in the draw.
/// Any row already standing at `new_hash` is dropped first, mirroring the
/// same guard in `rekey_song`.
pub(crate) fn rekey_play_stats(old_hash: &str, new_hash: &str) -> rusqlite::Result<()> {
    with_conn(|c| {
        c.execute(
            "DELETE FROM song_play_stats WHERE file_hash = ?1",
            params![new_hash],
        )?;
        c.execute(
            "UPDATE song_play_stats SET file_hash = ?2 WHERE file_hash = ?1",
            params![old_hash, new_hash],
        )?;
        Ok(())
    })
}

/// Draws an analyzed song, biased towards the ones the room has sung least.
///
/// Each candidate gets `1 / (1 + sung + 0.5 * skip)`, so a song nobody has
/// sung is twice as likely as one sung once and three times as likely as one
/// sung twice. The weight approaches zero but never reaches it: no song is
/// ever locked out of the draw.
///
/// The draw runs entirely in SQL — a running total over the pool, then the
/// first row past `roll * total` — so the song list is never materialised,
/// keeping the behaviour the offset-based draw it replaces had on large
/// libraries.
///
/// `roll` must be in `0.0..1.0`; callers pass a fresh random value. `exclude`
/// keeps the song that just played out of its own next draw.
pub(crate) fn pick_weighted_analyzed_song(
    exclude: Option<&str>,
    roll: f64,
) -> rusqlite::Result<Option<Song>> {
    // Summing the weights in SQL and comparing against `roll * total` leaves a
    // float-rounding sliver at the very top of the range where no row's running
    // total reaches the target. Keeping the roll just under 1.0 closes it, and
    // the fallback below covers the pool being non-empty regardless.
    let roll = roll.clamp(0.0, 1.0 - f64::EPSILON);
    let exclude = exclude.unwrap_or("");

    let hash: Option<String> = with_conn(|c| {
        c.query_row(
            "WITH pool AS (
                 SELECT s.id AS id,
                        s.file_hash AS file_hash,
                        1.0 / (1.0
                               + COALESCE(p.sung_count, 0)
                               + ?2 * COALESCE(p.skip_count, 0)) AS weight
                 FROM songs s
                 LEFT JOIN song_play_stats p ON p.file_hash = s.file_hash
                 WHERE s.is_analyzed = 1 AND s.file_hash <> ?1
             ),
             running AS (
                 SELECT file_hash,
                        SUM(weight) OVER (ORDER BY id ROWS UNBOUNDED PRECEDING) AS cumulative
                 FROM pool
             )
             SELECT file_hash
             FROM running
             WHERE cumulative >= ?3 * (SELECT SUM(weight) FROM pool)
             ORDER BY cumulative
             LIMIT 1",
            params![exclude, SKIP_WEIGHT, roll],
            |r| r.get(0),
        )
        .optional()
    })?;

    let hash = match hash {
        Some(hash) => Some(hash),
        // The pool is only genuinely empty when the library has no other
        // analyzed song; anything else here is the rounding sliver, so fall
        // back to the last row rather than reporting nothing to play.
        None => with_conn(|c| {
            c.query_row(
                "SELECT file_hash FROM songs
                 WHERE is_analyzed = 1 AND file_hash <> ?1
                 ORDER BY id DESC LIMIT 1",
                params![exclude],
                |r| r.get(0),
            )
            .optional()
        })?,
    };

    match hash {
        Some(hash) => load_song_by_hash(&hash),
        None => Ok(None),
    }
}
