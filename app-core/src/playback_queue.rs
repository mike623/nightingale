use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

use serde::{Deserialize, Serialize};

use crate::cache::playback_queue_path;
use crate::{Song, SongsStore};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackQueueEntry {
    pub id: String,
    pub song: Song,
    pub tempo: f64,
    pub key_offset: i32,
}

/// One saved entry. Only the song's identity is written down: the library owns
/// its title, path, and analysis state, so a reopened queue reads those again
/// rather than replaying a snapshot that may since have changed.
#[derive(Debug, Serialize, Deserialize)]
struct StoredEntry {
    id: String,
    file_hash: String,
    tempo: f64,
    key_offset: i32,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct StoredQueue {
    #[serde(default)]
    entries: Vec<StoredEntry>,
}

#[derive(Debug)]
pub struct PlaybackQueue {
    entries: Mutex<VecDeque<PlaybackQueueEntry>>,
    next_id: AtomicU64,
}

impl PlaybackQueue {
    /// Open the queue saved at `<data>/playback_queue.json`, so closing the app
    /// mid-party does not empty the room's line-up. Positions are preserved; an
    /// entry whose song has left the library is dropped, since nothing could
    /// play it. Ids resume above the highest saved one, keeping them unique for
    /// the reorder and remove commands that name them.
    pub fn load() -> Self {
        let stored = std::fs::read_to_string(playback_queue_path())
            .ok()
            .and_then(|json| serde_json::from_str::<StoredQueue>(&json).ok())
            .unwrap_or_default();

        let hashes: Vec<String> = stored
            .entries
            .iter()
            .map(|entry| entry.file_hash.clone())
            .collect();
        let songs: HashMap<String, Song> = SongsStore::load_by_hashes(&hashes)
            .into_iter()
            .map(|song| (song.file_hash.clone(), song))
            .collect();

        let entries: VecDeque<PlaybackQueueEntry> = stored
            .entries
            .into_iter()
            .filter_map(|entry| {
                Some(PlaybackQueueEntry {
                    id: entry.id,
                    song: songs.get(&entry.file_hash)?.clone(),
                    tempo: entry.tempo,
                    key_offset: entry.key_offset,
                })
            })
            .collect();

        let next_id = entries
            .iter()
            .filter_map(|entry| entry.id.parse::<u64>().ok())
            .max()
            .map_or(0, |highest| highest + 1);

        Self {
            entries: Mutex::new(entries),
            next_id: AtomicU64::new(next_id),
        }
    }

    pub fn entries(&self) -> Result<Vec<PlaybackQueueEntry>, String> {
        self.entries
            .lock()
            .map(|entries| entries.iter().cloned().collect())
            .map_err(|_| "playback queue lock poisoned".to_string())
    }

    pub fn add(
        &self,
        file_hash: &str,
        tempo: f64,
        key_offset: i32,
    ) -> Result<Vec<PlaybackQueueEntry>, String> {
        let song = SongsStore::load_by_hashes(&[file_hash.to_string()])
            .into_iter()
            .next()
            .ok_or_else(|| "song not found".to_string())?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "playback queue lock poisoned".to_string())?;

        entries.push_back(PlaybackQueueEntry {
            id,
            song,
            tempo,
            key_offset,
        });

        Ok(commit(&entries))
    }

    /// Move the entry named by `id` to `to_index`, clamping the target to the
    /// queue's current bounds. Position is the queue's whole meaning, so a
    /// reorder changes nothing else about the entry it moves.
    pub fn reorder(&self, id: &str, to_index: usize) -> Result<Vec<PlaybackQueueEntry>, String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "playback queue lock poisoned".to_string())?;

        let from = entries
            .iter()
            .position(|entry| entry.id == id)
            .ok_or_else(|| "queue entry not found".to_string())?;
        let entry = entries
            .remove(from)
            .ok_or_else(|| "queue entry not found".to_string())?;

        let target = to_index.min(entries.len());
        entries.insert(target, entry);

        Ok(commit(&entries))
    }

    pub fn remove(&self, id: &str) -> Result<Vec<PlaybackQueueEntry>, String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "playback queue lock poisoned".to_string())?;

        entries.retain(|entry| entry.id != id);

        Ok(commit(&entries))
    }

    pub fn clear(&self) -> Result<Vec<PlaybackQueueEntry>, String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "playback queue lock poisoned".to_string())?;

        entries.clear();

        Ok(commit(&entries))
    }
}

/// Save the queue and hand back the order callers publish. The line-up is worth
/// keeping across restarts but is not worth failing a command over, so a failed
/// write is logged and the in-memory queue stands.
fn commit(entries: &VecDeque<PlaybackQueueEntry>) -> Vec<PlaybackQueueEntry> {
    let stored = StoredQueue {
        entries: entries
            .iter()
            .map(|entry| StoredEntry {
                id: entry.id.clone(),
                file_hash: entry.song.file_hash.clone(),
                tempo: entry.tempo,
                key_offset: entry.key_offset,
            })
            .collect(),
    };

    if let Err(error) = save(&stored) {
        tracing::warn!("[playback queue] could not save the queue: {error}");
    }

    entries.iter().cloned().collect()
}

fn save(stored: &StoredQueue) -> std::io::Result<()> {
    let path = playback_queue_path();

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let json = serde_json::to_string_pretty(stored).map_err(std::io::Error::other)?;
    let temporary = path.with_extension("json.tmp");

    std::fs::write(&temporary, json)?;
    std::fs::rename(&temporary, &path)
}
