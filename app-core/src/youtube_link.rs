//! Reading a YouTube link that arrived from outside the host.
//!
//! The import page's own box is typed by the person sitting at the machine; a
//! link submitted from a phone is not. Both end up as arguments to a yt-dlp
//! process, so a link from the network is reduced here to the only thing that
//! is safe to act on — a video id — and rebuilt into a URL this module wrote
//! rather than forwarded from the request.

use url::Url;

/// A link is a URL, not a document. Anything longer is not one.
const MAX_URL_CHARS: usize = 2048;

/// Video ids are a fixed alphabet. Anything outside it is not an id, whatever
/// position it arrived in.
const MAX_ID_CHARS: usize = 64;

/// Hosts whose links name a YouTube video. Matched after lowercasing, and
/// never by suffix: `youtube.com.example.test` is not YouTube.
const HOSTS: &[&str] = &[
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
];

/// Paths that carry the video id as their last segment.
const ID_PATH_PREFIXES: &[&str] = &["/shorts/", "/live/", "/embed/"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum YoutubeLinkError {
    /// Too long, not a URL, not https, or not a YouTube host.
    NotAYoutubeLink,
    /// A playlist link. Enumerating one needs yt-dlp, and one submission should
    /// not be able to queue a hundred downloads.
    PlaylistNotAllowed,
    /// A YouTube page that is not a video — a channel, a search, the home page.
    NoVideoId,
}

impl YoutubeLinkError {
    pub fn message(self) -> &'static str {
        match self {
            Self::NotAYoutubeLink => "That is not a YouTube link",
            Self::PlaylistNotAllowed => "Playlists can only be imported from the app",
            Self::NoVideoId => "That link does not name a video",
        }
    }
}

fn is_id(candidate: &str) -> bool {
    !candidate.is_empty()
        && candidate.len() <= MAX_ID_CHARS
        && candidate
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// The video id a link names, for a link that names exactly one video.
///
/// Rejects playlists outright rather than reducing them to their first video:
/// silently importing one track of a playlist someone asked for would be a
/// worse answer than saying no.
pub fn video_id_of(link: &str) -> Result<String, YoutubeLinkError> {
    let trimmed = link.trim();
    if trimmed.is_empty() || trimmed.len() > MAX_URL_CHARS {
        return Err(YoutubeLinkError::NotAYoutubeLink);
    }

    let parsed = Url::parse(trimmed).map_err(|_| YoutubeLinkError::NotAYoutubeLink)?;
    if parsed.scheme() != "https" {
        return Err(YoutubeLinkError::NotAYoutubeLink);
    }

    let host = parsed
        .host_str()
        .ok_or(YoutubeLinkError::NotAYoutubeLink)?
        .to_ascii_lowercase();
    if !HOSTS.contains(&host.as_str()) {
        return Err(YoutubeLinkError::NotAYoutubeLink);
    }

    let mut id = None;
    for (key, value) in parsed.query_pairs() {
        match key.as_ref() {
            "list" => return Err(YoutubeLinkError::PlaylistNotAllowed),
            "v" if id.is_none() => id = Some(value.into_owned()),
            _ => {}
        }
    }

    if let Some(id) = id.filter(|id| is_id(id)) {
        return Ok(id);
    }

    let path = parsed.path();
    if host == "youtu.be" {
        let candidate = path.trim_start_matches('/');
        if is_id(candidate) {
            return Ok(candidate.to_string());
        }
    }

    for prefix in ID_PATH_PREFIXES {
        if let Some(candidate) = path.strip_prefix(prefix)
            && is_id(candidate)
        {
            return Ok(candidate.to_string());
        }
    }

    Err(YoutubeLinkError::NoVideoId)
}

/// The watch URL for a video id. Built here rather than taken from the request,
/// so nothing a submitter wrote reaches a subprocess argument.
pub fn watch_url(video_id: &str) -> String {
    format!(
        "https://www.youtube.com/watch?v={}",
        urlencoding::encode(video_id)
    )
}

/// What YouTube's oEmbed endpoint says a video is called.
///
/// Used only to answer a submitter quickly: yt-dlp is the authority at download
/// time, but reaching it can mean downloading the binary first, which is far too
/// long to hold a request open for. Failure is not an error — the caller falls
/// back to having no title yet.
pub fn oembed_title(video_id: &str) -> Option<(String, String)> {
    let endpoint = format!(
        "https://www.youtube.com/oembed?url={}&format=json",
        urlencoding::encode(&watch_url(video_id))
    );

    let mut response = ureq::get(&endpoint).call().ok()?;
    let body: serde_json::Value = response.body_mut().read_json().ok()?;
    let title = body.get("title")?.as_str()?.to_string();
    let author = body
        .get("author_name")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    Some((title, author))
}
