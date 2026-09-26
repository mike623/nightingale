//! The party surface: the narrow HTTP a phone uses to browse the library and
//! shape the queue, served beside the relay by both delivery targets.
//!
//! Everything here is reachable by anyone who can reach the address, so the
//! surface is deliberately small: read the library, read the queue, and move
//! songs within it. It exposes no filesystem path and no configuration.
//!
//! One route breaks the read-only shape: submitting a YouTube link runs a
//! yt-dlp process and writes a file into the library folder. It is off unless
//! the host turns it on, it takes a video id and nothing else from the
//! submitter, and it is the reason every value that leaves here is built from
//! the host's own data rather than passed through.

use std::sync::Arc;

use app_core::{
    LibraryMenuFilters, LoadSongsParams, PlaybackQueue, PlaybackQueueEntry, Song, SongsStore,
};
use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

/// Largest page a phone may ask for, and what it gets when it asks for none.
const MAX_TAKE: usize = 50;
const DEFAULT_TAKE: usize = 25;

/// A search term longer than this is a payload, not a song title.
const MAX_SEARCH_CHARS: usize = 200;

/// Identifiers are opaque, so they are bounded rather than parsed. Every
/// identifier this surface accepts is looked up before it is used.
const MAX_ID_CHARS: usize = 128;

/// Request bodies here carry one identifier and at most one index.
const MAX_BODY_BYTES: usize = 4 * 1024;

/// What the phone is told about a song. The stored [`Song`] also carries the
/// file's path on the host's disk and its cached artwork path; neither leaves
/// the machine.
#[derive(Debug, Serialize)]
pub struct PartySong {
    pub file_hash: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_secs: f64,
    pub is_analyzed: bool,
}

impl From<&Song> for PartySong {
    fn from(song: &Song) -> Self {
        Self {
            file_hash: song.file_hash.clone(),
            title: song.title.clone(),
            artist: song.artist.clone(),
            album: song.album.clone(),
            duration_secs: song.duration_secs,
            is_analyzed: song.is_analyzed,
        }
    }
}

/// The playing song's words, for reading along on a phone.
#[derive(Debug, Serialize)]
pub struct PartyLyrics {
    pub lines: Vec<String>,
    /// Whether this host accepts a lyric shift from a phone. The host applies
    /// that rule itself when a command arrives; this only decides whether the
    /// phone offers the buttons at all.
    pub shift_allowed: bool,
}

#[derive(Debug, Serialize)]
pub struct PartyEntry {
    pub id: String,
    pub song: PartySong,
}

#[derive(Debug, Serialize)]
pub struct PartySongsPage {
    pub songs: Vec<PartySong>,
    /// How many songs match the search, so the phone knows whether the list
    /// it is showing has more below it.
    pub total: usize,
}

/// How the surface's owner learns that the queue moved.
type QueueChanged = Arc<dyn Fn(&[PlaybackQueueEntry]) + Send + Sync>;

/// The queue this surface shapes, plus the way its owner announces a change.
/// The desktop passes a Tauri emit, the server its event bus: the phone is
/// never the only screen that has to learn the queue moved.
#[derive(Clone)]
pub struct PartyState {
    queue: Arc<PlaybackQueue>,
    on_change: QueueChanged,
}

impl PartyState {
    pub fn new(
        queue: Arc<PlaybackQueue>,
        on_change: impl Fn(&[PlaybackQueueEntry]) + Send + Sync + 'static,
    ) -> Self {
        Self {
            queue,
            on_change: Arc::new(on_change),
        }
    }
}

/// Routes for the party surface, mounted under `/party`.
pub fn router(state: PartyState) -> Router {
    Router::new()
        .route("/party/songs", get(songs))
        .route("/party/queue", get(queue).post(enqueue))
        .route("/party/queue/reorder", post(reorder))
        .route("/party/queue/:id", delete(dequeue))
        .route("/party/lyrics/:file_hash", get(lyrics))
        .route("/party/import", get(import_queue).post(submit_import))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .with_state(state)
}

struct PartyError(StatusCode, String);

impl IntoResponse for PartyError {
    fn into_response(self) -> Response {
        (self.0, self.1).into_response()
    }
}

fn bad_request(message: &str) -> PartyError {
    PartyError(StatusCode::BAD_REQUEST, message.to_string())
}

type PartyResult<T> = Result<Json<T>, PartyError>;

#[derive(Debug, Deserialize)]
struct SongsQuery {
    search: Option<String>,
    skip: Option<usize>,
    take: Option<usize>,
}

async fn songs(Query(query): Query<SongsQuery>) -> PartyResult<PartySongsPage> {
    let search = match query.search.as_deref().map(str::trim) {
        Some(term) if term.chars().count() > MAX_SEARCH_CHARS => {
            return Err(bad_request("search term is too long"));
        }
        Some(term) if !term.is_empty() => Some(term.to_string()),
        _ => None,
    };

    let params = LoadSongsParams {
        search,
        filters: LibraryMenuFilters::default(),
        sort: None,
        skip: query.skip.unwrap_or(0),
        take: query.take.unwrap_or(DEFAULT_TAKE).clamp(1, MAX_TAKE),
    };
    let store = SongsStore::load(&params);

    Ok(Json(PartySongsPage {
        songs: store.processed.iter().map(PartySong::from).collect(),
        total: store.processed_count,
    }))
}

/// Lyrics for one song. Free of paths and of timing: a phone reads along with
/// the screen everyone is already watching.
async fn lyrics(Path(file_hash): Path<String>) -> PartyResult<PartyLyrics> {
    let file_hash = checked_id(&file_hash)?;

    Ok(Json(PartyLyrics {
        lines: app_core::lyric_lines(file_hash),
        shift_allowed: app_core::AppConfig::load().party_lyric_shift,
    }))
}

fn entries_response(entries: &[PlaybackQueueEntry]) -> Vec<PartyEntry> {
    entries
        .iter()
        .map(|entry| PartyEntry {
            id: entry.id.clone(),
            song: PartySong::from(&entry.song),
        })
        .collect()
}

fn checked_id(id: &str) -> Result<&str, PartyError> {
    if id.is_empty() || id.chars().count() > MAX_ID_CHARS {
        return Err(bad_request("identifier is out of range"));
    }

    Ok(id)
}

async fn queue(State(state): State<PartyState>) -> PartyResult<Vec<PartyEntry>> {
    let entries = state
        .queue
        .entries()
        .map_err(|error| PartyError(StatusCode::INTERNAL_SERVER_ERROR, error))?;

    Ok(Json(entries_response(&entries)))
}

#[derive(Debug, Deserialize)]
struct EnqueueBody {
    file_hash: String,
}

async fn enqueue(
    State(state): State<PartyState>,
    Json(body): Json<EnqueueBody>,
) -> PartyResult<Vec<PartyEntry>> {
    let file_hash = checked_id(&body.file_hash)?;
    // The song's own tempo and key shift travel with it, the same values the
    // desktop puts on an entry it adds.
    let song = SongsStore::load_by_hashes(&[file_hash.to_string()])
        .into_iter()
        .next()
        .ok_or_else(|| bad_request("song not found"))?;
    let entries = state
        .queue
        .add(file_hash, song.tempo, song.key_offset)
        .map_err(|error| bad_request(&error))?;

    (state.on_change)(&entries);

    Ok(Json(entries_response(&entries)))
}

#[derive(Debug, Deserialize)]
struct ReorderBody {
    id: String,
    to_index: usize,
}

async fn reorder(
    State(state): State<PartyState>,
    Json(body): Json<ReorderBody>,
) -> PartyResult<Vec<PartyEntry>> {
    let id = checked_id(&body.id)?;
    let entries = state
        .queue
        .reorder(id, body.to_index)
        .map_err(|error| bad_request(&error))?;

    (state.on_change)(&entries);

    Ok(Json(entries_response(&entries)))
}

async fn dequeue(
    State(state): State<PartyState>,
    Path(id): Path<String>,
) -> PartyResult<Vec<PartyEntry>> {
    let id = checked_id(&id)?;
    let entries = state
        .queue
        .remove(id)
        .map_err(|error| PartyError(StatusCode::INTERNAL_SERVER_ERROR, error))?;

    (state.on_change)(&entries);

    Ok(Json(entries_response(&entries)))
}

/// A link is a URL. The body limit already bounds the request; this bounds the
/// one field inside it before it is parsed.
const MAX_LINK_CHARS: usize = 2048;

/// Why an import failed, as much as a guest is told.
///
/// The host's own reason comes from yt-dlp's stderr, which quotes the paths it
/// was writing to. That belongs on the machine that owns those paths, not on a
/// phone belonging to whoever is in the room.
#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum PartyImportProblem {
    Unavailable,
    Network,
    Failed,
}

fn coarse_problem(reason: &str) -> PartyImportProblem {
    let lower = reason.to_ascii_lowercase();

    if lower.contains("private")
        || lower.contains("unavailable")
        || lower.contains("removed")
        || lower.contains("age")
    {
        return PartyImportProblem::Unavailable;
    }

    if lower.contains("network") || lower.contains("timed out") || lower.contains("resolve") {
        return PartyImportProblem::Network;
    }

    PartyImportProblem::Failed
}

/// One import as a phone sees it. The stored row also carries the job it
/// belongs to, who submitted it, and the host's own failure text; none of that
/// leaves the machine.
#[derive(Debug, Serialize)]
pub struct PartyImport {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub duration_secs: f64,
    pub status: String,
    pub pct: f64,
    problem: Option<PartyImportProblem>,
}

impl From<&app_core::ImportQueueRow> for PartyImport {
    fn from(row: &app_core::ImportQueueRow) -> Self {
        Self {
            id: row.id.clone(),
            title: row.title.clone(),
            artist: row.artist.clone(),
            duration_secs: row.duration_secs,
            status: format!("{:?}", row.status).to_lowercase(),
            pct: row.pct,
            problem: row.reason.as_deref().map(coarse_problem),
        }
    }
}

#[derive(Debug, Deserialize)]
struct SubmitImportBody {
    url: String,
}

/// `None` when the host has not turned phone imports on. Read per request so
/// switching it off takes effect immediately rather than at the next restart.
fn import_enabled() -> bool {
    app_core::AppConfig::load().party_import
}

fn import_off() -> PartyError {
    PartyError(
        StatusCode::NOT_FOUND,
        "Importing from a phone is turned off".to_string(),
    )
}

/// Queue a YouTube video the phone asked for.
///
/// Only a video id survives from the request: the link is parsed, its host
/// checked against the allowlist, and the URL that reaches yt-dlp is rebuilt
/// from the id. Playlists are refused rather than reduced to one video.
///
/// Answers as soon as the row is queued. The title comes from oEmbed, which is
/// one request, because the alternative is holding this open while yt-dlp is
/// downloaded and updated.
async fn submit_import(
    State(_state): State<PartyState>,
    Json(body): Json<SubmitImportBody>,
) -> PartyResult<PartyImport> {
    if !import_enabled() {
        return Err(import_off());
    }

    if body.url.len() > MAX_LINK_CHARS {
        return Err(bad_request("that link is too long"));
    }

    let video_id = app_core::video_id_of(&body.url).map_err(|e| bad_request(e.message()))?;

    let (title, artist) = tokio::task::spawn_blocking({
        let video_id = video_id.clone();
        move || app_core::oembed_title(&video_id)
    })
    .await
    .ok()
    .flatten()
    .unwrap_or_else(|| (video_id.clone(), String::new()));

    let preview = app_core::ImportPreview {
        is_playlist: false,
        playlist_id: None,
        playlist_title: None,
        entries: vec![app_core::ImportEntry {
            id: video_id,
            title,
            artist,
            duration_secs: 0.0,
        }],
    };

    let rows = app_core::submit_import(&preview, app_core::ImportSubmitter::Phone)
        .map_err(|error| bad_request(&error))?;
    let row = rows
        .first()
        .ok_or_else(|| bad_request("nothing was queued"))?;

    Ok(Json(PartyImport::from(row)))
}

/// Every import the host is working through, whoever asked for it. A guest
/// waiting on one song should see the three ahead of it rather than a queue
/// that looks stuck.
async fn import_queue(State(_state): State<PartyState>) -> PartyResult<Vec<PartyImport>> {
    if !import_enabled() {
        return Err(import_off());
    }

    Ok(Json(
        app_core::import_queue()
            .iter()
            .map(PartyImport::from)
            .collect(),
    ))
}
