# Nightingale

Karaoke app: scans a music library, separates vocals, transcribes/aligns lyrics, and plays back with synchronized highlighting.

## Language

**Source** (a.k.a. Library Source):
A pluggable backend that enumerates and syncs a whole music library (Folder, Plex, Jellyfin, Navidrome). Exactly one is active at a time. Implements `MediaSource`.
_Avoid_: backend, provider

**Import**:
An action that pulls one or more tracks into the current library from outside the active Source — e.g. from a YouTube video or playlist link. An Import is not a Source: it adds Songs but does not scan or replace a library. Only available when the active Source is a **Folder** library: imported files are written into the watched folder (a playlist also writes a matching `.m3u`) and picked up as normal local Songs by the folder scan. Disabled on remote Sources (Plex/Jellyfin/Navidrome). Several links can be pasted at once (one per line): they resolve to a flat list of videos, de-duplicated by video id, and such an Import never writes an `.m3u` — only a lone playlist link keeps its playlist identity. Each track commits atomically and independently; a playlist Import continues past failed tracks. A video id is downloaded at most once per Import, so a link that lists the same video twice (a YouTube Music mix window does) still yields one file. Re-importing a playlist is a delta: videos already imported (tracked by id in a `.nightingale-imports.json` manifest in the folder) are skipped, and the playlist's existing `.m3u` is rewritten in place with the full current membership. An Import runs in the background and is driven from the **Import page** (`/import`, reached from the sidebar), which reports each track's own download progress and its terminal state (imported / skipped / failed); while the user is elsewhere in the app a single notification stands in for it.
_Avoid_: source, sync, download (as a noun)

**Title Breakdown**:
A user-triggered action that parses a messy YouTube-derived title (brackets, feat/remix tags, CJK ornamentation) into clean structured `{title, artist}`. Runs a bundled small local LLM (see docs/adr/0004), not the YouTube-Music `track`/`artist` fields, which are already clean and never sent through it. Click-to-call, never automatic; overwrites the editable title/artist fields on success and leaves them untouched on failure. See [[import]].
_Avoid_: cleanup, AI parse, title fix

**Auto-play next**:
A setting (`auto_play_next`, default off) that keeps playback going when a Song ends: instead of returning to the menu, a uniformly random **analyzed** Song from the library starts. A scored run shows its result for a short countdown first. Independent of **Next Song**, which is the same jump performed on demand.
_Avoid_: autoplay, shuffle (there is no queue or play order — each pick is an independent draw)

**Next Song**:
The on-demand jump to another random analyzed Song, offered on the **playback bar**, the pause overlay, the result screen, and the right arrow key. Every entry point calls one implementation.
_Avoid_: skip (skip means **Skip Intro**/**Skip Outro**, which move within the current Song)

**Playback bar**:
The bar along the bottom edge of playback carrying pause, **Next Song**, elapsed time, progress, and duration. Distinct from the **playback HUD**, which carries title, score, and the settings/shortcut hints. Auto-hides while singing and returns on mouse or key activity.
_Avoid_: transport bar, controls, seek bar (it does not scrub)

**Word-level lyrics**:
Per-word lyric timing produced by WhisperX alignment, enabling word-by-word karaoke highlighting. Opt-in (`word_level_lyrics`, default off). WhisperX runs only when word-level is enabled or forced for one Song. See [[import]] and docs/adr/0003.
_Avoid_: transcription (as a synonym — transcription is one way to obtain timing, not the timing itself)

**Lyric lookup**:
The LRCLIB search analysis performs to find **line-level** synced lyrics for a Song. Opt-in (`lyrics_lookup`, default off) — by default analysis only separates stems and detects key, leaving the Song lyric-less until lyrics are provided by hand. See docs/adr/0003.
_Avoid_: lyrics fetch, LRCLIB sync

**Remote**:
A phone on the same network controlling the running Song, opened by scanning a QR code shown on the host screen. The phone renders a snapshot the host publishes and sends back commands — the same commands the keyboard shortcuts fire, never a parallel implementation. Audio never leaves the host. One phone holds control at a time; the others watch and can take it over explicitly. On desktop the listener is opt-in (`remote_control`, default off); self-hosted serves it from the existing port. Unauthenticated by decision — see docs/adr/0005.
_Avoid_: jukebox, companion app, second screen (the phone controls the host, it does not play anything)

**Analysis worker**:
One thread draining the analysis queue, paired with its own analyzer server process. Up to two run at once (`analysis_workers`, default 2), so two Songs analyze in parallel.
_Avoid_: analysis thread, job runner
