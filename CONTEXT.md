# Nightingale

Karaoke app: scans a music library, separates vocals, transcribes/aligns lyrics, and plays back with synchronized highlighting.

## Language

**Source** (a.k.a. Library Source):
A pluggable backend that enumerates and syncs a whole music library (Folder, Plex, Jellyfin, Navidrome). Exactly one is active at a time. Implements `MediaSource`.
_Avoid_: backend, provider

**Import**:
An action that pulls one or more tracks into the current library from outside the active Source — e.g. from a YouTube video or playlist link. An Import is not a Source: it adds Songs but does not scan or replace a library. Only available when the active Source is a **Folder** library: imported files are written into the watched folder (a playlist also writes a matching `.m3u`) and picked up as normal local Songs by the folder scan. Disabled on remote Sources (Plex/Jellyfin/Navidrome). Each track commits atomically and independently; a playlist Import continues past failed tracks. Re-importing a playlist is a delta: videos already imported (tracked by id in a `.nightingale-imports.json` manifest in the folder) are skipped, and the playlist's existing `.m3u` is rewritten in place with the full current membership.
_Avoid_: source, sync, download (as a noun)

**Word-level lyrics**:
Per-word lyric timing produced by WhisperX alignment, enabling word-by-word karaoke highlighting. Opt-in (`word_level_lyrics`, default off). The default is **line-level** lyrics from LRCLIB (whole-line timing), which skips WhisperX; WhisperX transcription only runs when LRCLIB has no match or word-level is enabled. See [[import]] and docs/adr/0003.
_Avoid_: transcription (as a synonym — transcription is one way to obtain timing, not the timing itself)
