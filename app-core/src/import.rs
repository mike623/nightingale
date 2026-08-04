//! One-off YouTube Import: pull a single video or a whole playlist into the
//! active Folder library. An Import is not a Source (see docs/adr/0001) — it is
//! only valid when the active library is a Folder. Imported files are written
//! into the watched folder (a playlist also gets a matching `.m3u`) and picked
//! up by the normal folder scan, so they flow through analysis + LRCLIB lyrics
//! exactly like any other local file.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tracing::warn;
use ts_rs::TS;

use crate::config::{AppConfig, LibrarySource};
use crate::vendor::{ensure_ytdlp, ffmpeg_path, silent_command};

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ImportEntry {
    /// YouTube video id — the stable handle we re-download by.
    pub id: String,
    pub title: String,
    pub artist: String,
    #[serde(default)]
    pub duration_secs: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub is_playlist: bool,
    /// Stable playlist id (yt-dlp `id`), used to recognise a re-import of the
    /// same playlist and reuse its `.m3u`. `None` for a single video.
    pub playlist_id: Option<String>,
    /// Playlist title, when the URL resolved to a playlist.
    pub playlist_title: Option<String>,
    pub entries: Vec<ImportEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ImportFailure {
    pub title: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub imported: usize,
    /// Entries already present from a previous import (id matched, file on disk).
    pub skipped: usize,
    pub failed: Vec<ImportFailure>,
    pub playlist_name: Option<String>,
}

/// Progress tick emitted while a (possibly background) import runs.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub done: usize,
    pub total: usize,
    /// Title of the entry currently being downloaded, if any.
    pub current: Option<String>,
    pub imported: usize,
    pub skipped: usize,
    pub failed: usize,
}

/// Persisted in the watched folder as `.nightingale-imports.json`. Lets a
/// re-import of the same playlist skip videos already downloaded (delta) and
/// reuse the playlist's `.m3u` instead of spawning a new one.
#[derive(Debug, Default, Serialize, Deserialize)]
struct ImportManifest {
    /// YouTube video id → imported file basename.
    #[serde(default)]
    videos: BTreeMap<String, String>,
    /// Playlist id (or title fallback) → its `.m3u` basename.
    #[serde(default)]
    playlists: BTreeMap<String, String>,
}

/// The watched folder root, iff the active Source is a Folder library.
/// `None` means Import is unavailable (no source, or a remote source).
pub fn import_folder_root() -> Option<PathBuf> {
    match AppConfig::load().library_source {
        Some(LibrarySource::Folder { path }) => Some(path),
        _ => None,
    }
}

pub fn import_available() -> bool {
    import_folder_root().is_some()
}

/// Resolve a YouTube URL to a preview without downloading media. `--flat-playlist`
/// lists playlist entries cheaply; a bare video resolves to a single entry.
pub fn probe(url: &str) -> Result<ImportPreview, String> {
    let yt = ensure_ytdlp()?;
    let out = silent_command(&yt)
        .args(["--flat-playlist", "--no-warnings", "-J", url])
        .output()
        .map_err(|e| format!("Failed to run yt-dlp: {e}"))?;
    if !out.status.success() {
        return Err(short_err("Could not read URL", &out.stderr));
    }
    let json: serde_json::Value =
        serde_json::from_slice(&out.stdout).map_err(|e| format!("Unexpected yt-dlp output: {e}"))?;

    let is_playlist = json.get("_type").and_then(|v| v.as_str()) == Some("playlist");
    if is_playlist {
        let playlist_id = json.get("id").and_then(|v| v.as_str()).map(str::to_string);
        let playlist_title = json
            .get("title")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let entries = json
            .get("entries")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(entry_from_json).collect())
            .unwrap_or_default();
        Ok(ImportPreview {
            is_playlist: true,
            playlist_id,
            playlist_title,
            entries,
        })
    } else {
        let entry =
            entry_from_json(&json).ok_or_else(|| "yt-dlp returned no usable video".to_string())?;
        Ok(ImportPreview {
            is_playlist: false,
            playlist_id: None,
            playlist_title: None,
            entries: vec![entry],
        })
    }
}

/// Download each entry into the folder, embedding the (possibly user-edited)
/// title/artist so the folder scan and LRCLIB search see clean metadata.
///
/// Delta-aware: a video already imported (id in the manifest, file still on
/// disk) is skipped, so re-importing a playlist only pulls the new videos.
/// Per-item atomic: a failed entry is recorded and skipped, the rest continue.
/// For a playlist it (re)writes the playlist's `.m3u` — reusing the same file
/// across re-imports — with the full current membership in playlist order, then
/// triggers a rescan.
pub fn run_import(
    preview: &ImportPreview,
    mut on_progress: impl FnMut(ImportProgress),
) -> Result<ImportReport, String> {
    let root = import_folder_root()
        .ok_or_else(|| "Import is only available with a Folder library".to_string())?;
    let yt = ensure_ytdlp()?;
    std::fs::create_dir_all(&root).map_err(|e| format!("Cannot create library folder: {e}"))?;

    let mut manifest = load_manifest(&root);
    let mut imported = 0usize;
    let mut skipped = 0usize;
    let mut failed: Vec<ImportFailure> = Vec::new();

    let total = preview.entries.len();
    for (done, entry) in preview.entries.iter().enumerate() {
        on_progress(ImportProgress {
            done,
            total,
            current: Some(entry.title.clone()),
            imported,
            skipped,
            failed: failed.len(),
        });
        // Delta skip: already imported and the file is still there.
        if let Some(name) = manifest.videos.get(&entry.id) {
            if root.join(name).exists() {
                skipped += 1;
                continue;
            }
        }
        match download_entry(&yt, &root, entry) {
            Ok(path) => {
                if let Some(name) = path.file_name().and_then(|s| s.to_str()) {
                    manifest.videos.insert(entry.id.clone(), name.to_string());
                }
                imported += 1;
            }
            Err(reason) => {
                warn!("[import] \"{}\" failed: {reason}", entry.title);
                failed.push(ImportFailure {
                    title: entry.title.clone(),
                    reason,
                });
            }
        }
    }

    on_progress(ImportProgress {
        done: total,
        total,
        current: None,
        imported,
        skipped,
        failed: failed.len(),
    });

    let mut wrote_playlist = false;
    let playlist_name = if preview.is_playlist {
        let display = preview
            .playlist_title
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "YouTube Import".to_string());
        let key = preview
            .playlist_id
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| display.clone());

        // Full current membership, in playlist order, of every track we hold.
        let members: Vec<String> = preview
            .entries
            .iter()
            .filter_map(|e| manifest.videos.get(&e.id).cloned())
            .filter(|name| root.join(name).exists())
            .collect();

        if members.is_empty() {
            None
        } else {
            // Reuse this playlist's existing `.m3u` (option A), else mint one.
            let m3u_name = match manifest.playlists.get(&key) {
                Some(existing) if root.join(existing).exists() => existing.clone(),
                _ => file_name_of(unique_path(&root, &display, "m3u")),
            };
            write_m3u_members(&root.join(&m3u_name), &members)?;
            manifest.playlists.insert(key, m3u_name);
            wrote_playlist = true;
            Some(display)
        }
    } else {
        None
    };

    save_manifest(&root, &manifest);

    if imported > 0 || wrote_playlist {
        crate::scanner::start_scan();
    }

    Ok(ImportReport {
        imported,
        skipped,
        failed,
        playlist_name,
    })
}

fn manifest_path(root: &Path) -> PathBuf {
    root.join(".nightingale-imports.json")
}

fn load_manifest(root: &Path) -> ImportManifest {
    std::fs::read(manifest_path(root))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn save_manifest(root: &Path, m: &ImportManifest) {
    match serde_json::to_vec_pretty(m) {
        Ok(json) => {
            if let Err(e) = std::fs::write(manifest_path(root), json) {
                warn!("[import] failed to write manifest: {e}");
            }
        }
        Err(e) => warn!("[import] failed to serialize manifest: {e}"),
    }
}

fn file_name_of(path: PathBuf) -> String {
    path.file_name()
        .and_then(|s| s.to_str())
        .map(str::to_string)
        .unwrap_or_default()
}

fn entry_from_json(v: &serde_json::Value) -> Option<ImportEntry> {
    let id = v.get("id").and_then(|x| x.as_str())?.to_string();
    if id.is_empty() {
        return None;
    }
    let raw_title = v.get("title").and_then(|x| x.as_str()).unwrap_or("").to_string();
    // Prefer YouTube Music's structured fields; fall back to parsing the title.
    let track = v.get("track").and_then(|x| x.as_str()).map(str::to_string);
    let artist = v
        .get("artist")
        .and_then(|x| x.as_str())
        .or_else(|| v.get("uploader").and_then(|x| x.as_str()))
        .map(clean_artist)
        .unwrap_or_default();
    let (title, artist) = split_title_artist(&raw_title, track, artist);
    let duration_secs = v.get("duration").and_then(|x| x.as_f64()).unwrap_or(0.0);
    Some(ImportEntry {
        id,
        title,
        artist,
        duration_secs,
    })
}

fn clean_artist(a: &str) -> String {
    a.trim().trim_end_matches("- Topic").trim().to_string()
}

/// Best-effort title/artist. Trust YouTube Music's `track` when present;
/// otherwise split a plain `"Artist - Title"` heading.
fn split_title_artist(raw_title: &str, track: Option<String>, artist: String) -> (String, String) {
    if let Some(t) = track.filter(|t| !t.trim().is_empty()) {
        let a = if artist.is_empty() {
            raw_title
                .split_once(" - ")
                .map(|(a, _)| a.trim().to_string())
                .unwrap_or_default()
        } else {
            artist
        };
        return (t.trim().to_string(), a);
    }
    if artist.is_empty() {
        if let Some((a, t)) = raw_title.split_once(" - ") {
            return (t.trim().to_string(), a.trim().to_string());
        }
    }
    (raw_title.trim().to_string(), artist)
}

fn download_entry(yt: &Path, root: &Path, entry: &ImportEntry) -> Result<PathBuf, String> {
    let tmp = root.join(format!(".import_tmp_{}", sanitize(&entry.id)));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| format!("Cannot create temp dir: {e}"))?;

    let result = (|| {
        let url = format!("https://www.youtube.com/watch?v={}", entry.id);
        let out_tmpl = tmp.join("%(id)s.%(ext)s");
        let dl = silent_command(yt)
            .args([
                "-f",
                "bv*+ba/b",
                "--merge-output-format",
                "mp4",
                "--no-playlist",
                "--no-warnings",
                "-o",
            ])
            .arg(&out_tmpl)
            .arg(&url)
            .output()
            .map_err(|e| format!("Failed to run yt-dlp: {e}"))?;
        if !dl.status.success() {
            return Err(short_err("Download failed", &dl.stderr));
        }
        let downloaded = first_file_in(&tmp).ok_or("yt-dlp produced no file")?;
        let dest = unique_path(root, &format!("{} - {}", entry.artist, entry.title), "mp4");
        embed_and_move(&downloaded, &dest, &entry.title, &entry.artist)?;
        Ok(dest)
    })();

    let _ = std::fs::remove_dir_all(&tmp);
    result
}

/// Stream-copy `src` into `dest` while stamping title/artist tags (fast, no
/// re-encode). Falls back to a plain move if ffmpeg is missing or errors — the
/// file still imports, just with weaker metadata.
fn embed_and_move(src: &Path, dest: &Path, title: &str, artist: &str) -> Result<(), String> {
    let ff = ffmpeg_path();
    if ff.is_file() {
        let out = silent_command(&ff)
            .arg("-y")
            .arg("-i")
            .arg(src)
            .args(["-map", "0", "-c", "copy", "-metadata"])
            .arg(format!("title={title}"))
            .arg("-metadata")
            .arg(format!("artist={artist}"))
            .arg(dest)
            .output()
            .map_err(|e| format!("Failed to run ffmpeg: {e}"))?;
        if out.status.success() {
            return Ok(());
        }
        warn!(
            "[import] ffmpeg metadata embed failed, moving file as-is: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    std::fs::rename(src, dest)
        .or_else(|_| std::fs::copy(src, dest).map(|_| ()))
        .map_err(|e| format!("Failed to move imported file: {e}"))
}

fn write_m3u_members(path: &Path, basenames: &[String]) -> Result<(), String> {
    let mut body = String::from("#EXTM3U\n");
    for n in basenames {
        body.push_str(n);
        body.push('\n');
    }
    std::fs::write(path, body).map_err(|e| format!("Failed to write playlist: {e}"))
}

fn unique_path(root: &Path, stem: &str, ext: &str) -> PathBuf {
    let base = {
        let s = sanitize(stem.trim().trim_start_matches("- ").trim());
        if s.is_empty() {
            "youtube-import".to_string()
        } else {
            s
        }
    };
    let mut candidate = root.join(format!("{base}.{ext}"));
    let mut n = 1;
    while candidate.exists() {
        candidate = root.join(format!("{base} ({n}).{ext}"));
        n += 1;
    }
    candidate
}

fn sanitize(s: &str) -> String {
    s.chars()
        .map(|c| if "/\\:*?\"<>|".contains(c) { '_' } else { c })
        .collect::<String>()
        .trim()
        .to_string()
}

fn first_file_in(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .find(|p| p.is_file())
}

/// Collapse a multi-line stderr into a single short reason for the UI. yt-dlp
/// puts the useful line last (`ERROR: ...`).
fn short_err(prefix: &str, stderr: &[u8]) -> String {
    let text = String::from_utf8_lossy(stderr);
    let line = text
        .lines()
        .rev()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("")
        .trim();
    if line.is_empty() {
        prefix.to_string()
    } else {
        format!("{prefix}: {line}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_prefers_track_field() {
        let (t, a) = split_title_artist("RM - Song (Official)", Some("Song".into()), "RM".into());
        assert_eq!(t, "Song");
        assert_eq!(a, "RM");
    }

    #[test]
    fn split_falls_back_to_dash() {
        let (t, a) = split_title_artist("Artist - Title", None, String::new());
        assert_eq!(t, "Title");
        assert_eq!(a, "Artist");
    }

    #[test]
    fn split_no_dash_keeps_raw_title() {
        let (t, a) = split_title_artist("Just A Title", None, String::new());
        assert_eq!(t, "Just A Title");
        assert_eq!(a, "");
    }

    #[test]
    fn clean_artist_strips_topic() {
        assert_eq!(clean_artist("Some Artist - Topic"), "Some Artist");
    }

    #[test]
    fn sanitize_removes_path_separators() {
        assert_eq!(sanitize("a/b:c?"), "a_b_c_");
    }

    #[test]
    fn manifest_round_trips() {
        let mut m = ImportManifest::default();
        m.videos.insert("abc".into(), "A - B.mp4".into());
        m.playlists.insert("PL1".into(), "List.m3u".into());
        let json = serde_json::to_vec(&m).unwrap();
        let back: ImportManifest = serde_json::from_slice(&json).unwrap();
        assert_eq!(back.videos.get("abc").unwrap(), "A - B.mp4");
        assert_eq!(back.playlists.get("PL1").unwrap(), "List.m3u");
    }

    #[test]
    fn unique_path_appends_counter_on_clash() {
        let dir = std::env::temp_dir().join(format!("ng_import_test_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let first = unique_path(&dir, "X - Y", "mp4");
        std::fs::write(&first, b"x").unwrap();
        let second = unique_path(&dir, "X - Y", "mp4");
        assert_ne!(first, second);
        assert!(second.to_string_lossy().contains("(1)"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
