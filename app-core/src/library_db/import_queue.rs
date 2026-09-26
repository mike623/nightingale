//! Persistent YouTube-import queue.
//!
//! Backs `import::ImportQueue`. One row per video, carrying the job that
//! submitted it and where that video has got to. Unlike the analyzer's queue
//! the terminal rows are kept rather than deleted, because the import screen
//! reports what happened to a run after it ends.

use rusqlite::params;

use crate::import::{ImportEntryStatus, ImportQueueRow, ImportSubmitter};

use super::connection::{with_conn, with_conn_mut};

/// The DB spelling of a status. The `CHECK` constraint holds these exact
/// strings, so the mapping is one place rather than scattered literals.
fn status_to_db(status: ImportEntryStatus) -> &'static str {
    match status {
        ImportEntryStatus::Draft => "draft",
        ImportEntryStatus::Queued => "queued",
        ImportEntryStatus::Downloading => "downloading",
        ImportEntryStatus::Imported => "imported",
        ImportEntryStatus::Skipped => "skipped",
        ImportEntryStatus::Failed => "failed",
    }
}

/// An unknown string can only come from a newer build writing this database,
/// so it reads back as the state that is safe to act on: nothing runs a draft.
fn status_from_db(value: &str) -> ImportEntryStatus {
    match value {
        "queued" => ImportEntryStatus::Queued,
        "downloading" => ImportEntryStatus::Downloading,
        "imported" => ImportEntryStatus::Imported,
        "skipped" => ImportEntryStatus::Skipped,
        "failed" => ImportEntryStatus::Failed,
        _ => ImportEntryStatus::Draft,
    }
}

fn submitter_to_db(submitter: ImportSubmitter) -> &'static str {
    match submitter {
        ImportSubmitter::Desktop => "desktop",
        ImportSubmitter::Phone => "phone",
    }
}

/// Defaults to `Phone`, the narrower of the two: a row whose origin cannot be
/// read must not inherit the desktop's freedom to act on the playback queue.
fn submitter_from_db(value: &str) -> ImportSubmitter {
    match value {
        "desktop" => ImportSubmitter::Desktop,
        _ => ImportSubmitter::Phone,
    }
}

const COLUMNS: &str = "video_id, job_id, title, artist, duration_secs, playlist_id, \
     playlist_title, status, pct, reason, submitted_by, position, created_at";

fn row_from_sql(r: &rusqlite::Row<'_>) -> rusqlite::Result<ImportQueueRow> {
    Ok(ImportQueueRow {
        id: r.get(0)?,
        job_id: r.get(1)?,
        title: r.get(2)?,
        artist: r.get(3)?,
        duration_secs: r.get(4)?,
        playlist_id: r.get(5)?,
        playlist_title: r.get(6)?,
        status: status_from_db(&r.get::<_, String>(7)?),
        pct: r.get(8)?,
        reason: r.get(9)?,
        submitted_by: submitter_from_db(&r.get::<_, String>(10)?),
        position: r.get::<_, i64>(11)? as usize,
        created_at: r.get(12)?,
    })
}

/// Every row, oldest job first and in submission order within a job — the
/// order the import screen and the phone both read it in.
pub(crate) fn import_queue_load_rows() -> rusqlite::Result<Vec<ImportQueueRow>> {
    with_conn(|c| {
        let mut stmt = c.prepare(&format!(
            "SELECT {COLUMNS} FROM import_queue ORDER BY created_at, position"
        ))?;
        let rows = stmt.query_map([], row_from_sql)?;
        rows.collect()
    })
}

/// Add a job's rows. A video already in the queue keeps its row and is moved to
/// the new job: re-submitting a link is a request to import it, not a request
/// for two rows describing one file.
pub(crate) fn import_queue_insert_rows(rows: &[ImportQueueRow]) -> rusqlite::Result<()> {
    with_conn_mut(|c| {
        let tx = c.transaction()?;
        for row in rows {
            tx.execute(
                &format!(
                    "INSERT INTO import_queue ({COLUMNS})
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                     ON CONFLICT(video_id) DO UPDATE SET
                       job_id = excluded.job_id,
                       title = excluded.title,
                       artist = excluded.artist,
                       duration_secs = excluded.duration_secs,
                       playlist_id = excluded.playlist_id,
                       playlist_title = excluded.playlist_title,
                       status = excluded.status,
                       pct = excluded.pct,
                       reason = excluded.reason,
                       submitted_by = excluded.submitted_by,
                       position = excluded.position,
                       created_at = excluded.created_at"
                ),
                params![
                    row.id,
                    row.job_id,
                    row.title,
                    row.artist,
                    row.duration_secs,
                    row.playlist_id,
                    row.playlist_title,
                    status_to_db(row.status),
                    row.pct,
                    row.reason,
                    submitter_to_db(row.submitted_by),
                    row.position as i64,
                    row.created_at,
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    })
}

pub(crate) fn import_queue_update_status(
    video_id: &str,
    status: ImportEntryStatus,
    pct: f64,
    reason: Option<&str>,
) -> rusqlite::Result<()> {
    with_conn_mut(|c| {
        c.execute(
            "UPDATE import_queue SET status = ?2, pct = ?3, reason = ?4 WHERE video_id = ?1",
            params![video_id, status_to_db(status), pct, reason],
        )?;
        Ok(())
    })
}

/// The job the worker should run next: the oldest one still holding a queued
/// row. Jobs run whole and in submission order, so a phone's single video waits
/// behind a playlist submitted before it rather than interleaving with it.
pub(crate) fn import_queue_next_job() -> rusqlite::Result<Option<String>> {
    with_conn(|c| {
        c.query_row(
            "SELECT job_id FROM import_queue WHERE status = 'queued'
             ORDER BY created_at, position LIMIT 1",
            [],
            |r| r.get(0),
        )
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other),
        })
    })
}

/// The still-queued rows of one job, in submission order. Rows that already
/// reached a terminal status are left out: a job re-run after a partial failure
/// should not re-report the entries that already landed.
pub(crate) fn import_queue_job_rows(job_id: &str) -> rusqlite::Result<Vec<ImportQueueRow>> {
    with_conn(|c| {
        let mut stmt = c.prepare(&format!(
            "SELECT {COLUMNS} FROM import_queue
             WHERE job_id = ?1 AND status = 'queued' ORDER BY position"
        ))?;
        let rows = stmt.query_map([job_id], row_from_sql)?;
        rows.collect()
    })
}

/// Drop every row a run has finished with, leaving what is still to come.
/// Terminal rows are kept so the import screen can report on a run after it
/// ends, which means something has to be able to let them go.
pub(crate) fn import_queue_delete_finished() -> rusqlite::Result<usize> {
    with_conn_mut(|c| {
        c.execute(
            "DELETE FROM import_queue WHERE status IN ('imported', 'skipped', 'failed')",
            [],
        )
    })
}

/// Put downloads that were in flight when the process ended back in the queue.
/// The yt-dlp process that owned them is gone and its scratch directory was
/// removed with it, so the row describes work that is no longer happening. A
/// file that did land is skipped by the manifest delta without downloading.
pub(crate) fn import_queue_requeue_stale() -> rusqlite::Result<()> {
    with_conn_mut(|c| {
        c.execute(
            "UPDATE import_queue SET status = 'queued', pct = 0, reason = NULL
             WHERE status = 'downloading'",
            [],
        )?;
        Ok(())
    })
}
