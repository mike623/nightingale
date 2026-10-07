//! Persistent YouTube-import queue.
//!
//! Backs `import::ImportQueue`. One row per video, carrying the job that
//! submitted it and where that video has got to. Unlike the analyzer's queue
//! the terminal rows are kept rather than deleted, because the import screen
//! reports what happened to a run after it ends.

use diesel::prelude::*;
use diesel::upsert::excluded;

use crate::error::NightingaleError;
use crate::import::{ImportEntryStatus, ImportQueueRow, ImportSubmitter};

use super::connection::{with_conn, with_conn_mut};
use super::schema::import_queue;

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

#[derive(Queryable, Selectable, Insertable)]
#[diesel(table_name = import_queue)]
struct QueueRecord {
    video_id: String,
    job_id: String,
    title: String,
    artist: String,
    duration_secs: f64,
    playlist_id: Option<String>,
    playlist_title: Option<String>,
    status: String,
    pct: f64,
    reason: Option<String>,
    submitted_by: String,
    position: i64,
    created_at: i64,
}

impl From<QueueRecord> for ImportQueueRow {
    fn from(r: QueueRecord) -> Self {
        Self {
            id: r.video_id,
            job_id: r.job_id,
            title: r.title,
            artist: r.artist,
            duration_secs: r.duration_secs,
            playlist_id: r.playlist_id,
            playlist_title: r.playlist_title,
            status: status_from_db(&r.status),
            pct: r.pct,
            reason: r.reason,
            submitted_by: submitter_from_db(&r.submitted_by),
            position: r.position as usize,
            created_at: r.created_at,
        }
    }
}

impl From<&ImportQueueRow> for QueueRecord {
    fn from(row: &ImportQueueRow) -> Self {
        Self {
            video_id: row.id.clone(),
            job_id: row.job_id.clone(),
            title: row.title.clone(),
            artist: row.artist.clone(),
            duration_secs: row.duration_secs,
            playlist_id: row.playlist_id.clone(),
            playlist_title: row.playlist_title.clone(),
            status: status_to_db(row.status).to_string(),
            pct: row.pct,
            reason: row.reason.clone(),
            submitted_by: submitter_to_db(row.submitted_by).to_string(),
            position: row.position as i64,
            created_at: row.created_at,
        }
    }
}

const TERMINAL: [&str; 3] = ["imported", "skipped", "failed"];

/// Every row, oldest job first and in submission order within a job — the
/// order the import screen and the phone both read it in.
pub(crate) fn import_queue_load_rows() -> Result<Vec<ImportQueueRow>, NightingaleError> {
    with_conn(|conn| {
        let rows = import_queue::table
            .order((import_queue::created_at, import_queue::position))
            .select(QueueRecord::as_select())
            .load(conn)?;
        Ok(rows.into_iter().map(Into::into).collect())
    })
}

/// Add a job's rows. A video already in the queue keeps its row and is moved to
/// the new job: re-submitting a link is a request to import it, not a request
/// for two rows describing one file.
pub(crate) fn import_queue_insert_rows(rows: &[ImportQueueRow]) -> Result<(), NightingaleError> {
    with_conn_mut(|conn| {
        conn.transaction::<_, NightingaleError, _>(|conn| {
            for row in rows {
                diesel::insert_into(import_queue::table)
                    .values(QueueRecord::from(row))
                    .on_conflict(import_queue::video_id)
                    .do_update()
                    .set((
                        import_queue::job_id.eq(excluded(import_queue::job_id)),
                        import_queue::title.eq(excluded(import_queue::title)),
                        import_queue::artist.eq(excluded(import_queue::artist)),
                        import_queue::duration_secs.eq(excluded(import_queue::duration_secs)),
                        import_queue::playlist_id.eq(excluded(import_queue::playlist_id)),
                        import_queue::playlist_title.eq(excluded(import_queue::playlist_title)),
                        import_queue::status.eq(excluded(import_queue::status)),
                        import_queue::pct.eq(excluded(import_queue::pct)),
                        import_queue::reason.eq(excluded(import_queue::reason)),
                        import_queue::submitted_by.eq(excluded(import_queue::submitted_by)),
                        import_queue::position.eq(excluded(import_queue::position)),
                        import_queue::created_at.eq(excluded(import_queue::created_at)),
                    ))
                    .execute(conn)?;
            }
            Ok(())
        })
    })
}

pub(crate) fn import_queue_update_status(
    video_id: &str,
    status: ImportEntryStatus,
    pct: f64,
    reason: Option<&str>,
) -> Result<(), NightingaleError> {
    with_conn_mut(|conn| {
        diesel::update(import_queue::table.find(video_id))
            .set((
                import_queue::status.eq(status_to_db(status)),
                import_queue::pct.eq(pct),
                import_queue::reason.eq(reason),
            ))
            .execute(conn)?;
        Ok(())
    })
}

/// The job the worker should run next: the oldest one still holding a queued
/// row. Jobs run whole and in submission order, so a phone's single video waits
/// behind a playlist submitted before it rather than interleaving with it.
pub(crate) fn import_queue_next_job() -> Result<Option<String>, NightingaleError> {
    with_conn(|conn| {
        Ok(import_queue::table
            .filter(import_queue::status.eq("queued"))
            .order((import_queue::created_at, import_queue::position))
            .select(import_queue::job_id)
            .first::<String>(conn)
            .optional()?)
    })
}

/// The still-queued rows of one job, in submission order. Rows that already
/// reached a terminal status are left out: a job re-run after a partial failure
/// should not re-report the entries that already landed.
pub(crate) fn import_queue_job_rows(job_id: &str) -> Result<Vec<ImportQueueRow>, NightingaleError> {
    with_conn(|conn| {
        let rows = import_queue::table
            .filter(import_queue::job_id.eq(job_id))
            .filter(import_queue::status.eq("queued"))
            .order(import_queue::position)
            .select(QueueRecord::as_select())
            .load(conn)?;
        Ok(rows.into_iter().map(Into::into).collect())
    })
}

/// Drop every row a run has finished with, leaving what is still to come.
/// Terminal rows are kept so the import screen can report on a run after it
/// ends, which means something has to be able to let them go.
pub(crate) fn import_queue_delete_finished() -> Result<usize, NightingaleError> {
    with_conn_mut(|conn| {
        Ok(
            diesel::delete(import_queue::table.filter(import_queue::status.eq_any(TERMINAL)))
                .execute(conn)?,
        )
    })
}

/// Put downloads that were in flight when the process ended back in the queue.
/// The yt-dlp process that owned them is gone and its scratch directory was
/// removed with it, so the row describes work that is no longer happening. A
/// file that did land is skipped by the manifest delta without downloading.
pub(crate) fn import_queue_requeue_stale() -> Result<(), NightingaleError> {
    with_conn_mut(|conn| {
        diesel::update(import_queue::table.filter(import_queue::status.eq("downloading")))
            .set((
                import_queue::status.eq("queued"),
                import_queue::pct.eq(0.0),
                import_queue::reason.eq(None::<String>),
            ))
            .execute(conn)?;
        Ok(())
    })
}
