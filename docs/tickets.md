# Backlog — future improvements

Local ticket notes. Not pushed to `rzru/nightingale` (upstream is discussion-first;
this repo isn't ours). Promote to GitHub issues via `gh issue create` if/when wanted.

---

## T-001 — Toggle lyrics display with hotkey `L`

**Want:** hide/show the on-screen lyrics during playback, bound to `L`.

**Where:**
- Lyrics render in the playback HUD — `client/src/components/playback/playback-hud.tsx` and the transcript context `client/src/contexts/playback/playback-transcript-context.tsx`.
- Playback key handling — `client/src/hooks/playback/use-playback-input.ts`.

**Sketch:** add a `lyricsHidden` bit (local state or playback context), gate the lyric
overlay on it, add an `L` case in the playback input handler to flip it. Optionally
persist as a config flag. No backend change.

---

## T-002 — Resizable pitch-match diagram

**Want:** let the user resize the pitch/matching-line graph.

**Where:**
- `client/src/components/playback/pitch-graph.tsx` (the ref-vs-user pitch + similarity graph).
- Buffer length is fixed at `PITCH_BUFFER_SIZE = 200` in `client/src/lib/pitch/constants.ts` — governs how much history the graph shows (its horizontal span).

**Sketch:** expose height (and maybe time-window/`PITCH_BUFFER_SIZE`) as adjustable —
drag handle or a settings slider. Persist the size. Frontend-only.

---

## T-003 — User-controllable scoring tolerance

**Want:** control how strict pitch matching is.

**Where:**
- `SEMITONE_TOLERANCE = 6` in `client/src/lib/pitch/constants.ts` — the divisor in
  `pitchSimilarity` (`client/src/lib/pitch/state.ts`): `similarity = max(0, 1 − diff/tolerance)`.
  Lower = stricter, higher = more forgiving.

**Sketch:** add a config field (e.g. `pitch_tolerance_semitones`, default 6) in
`app-core/src/config.rs` + accessor, thread it into `usePitchScoring` /
`pitchSimilarity` instead of the constant, and add a Settings slider (Analysis or a
new Scoring section). Mirrors the existing `word_level_lyrics` toggle wiring
(config field → ts-rs type → settings control).

---

## T-004 — Background YouTube import

**Want:** imports run in the background — close the dialog, keep using the app,
get notified on completion. Today `run_import` blocks the dialog (single spinner)
for the whole download; a big playlist locks the user into the modal.

**Where:**
- `app-core/src/import.rs` `run_import` (synchronous loop over entries).
- Command `client/src-tauri/src/import.rs` (`run_import`, currently `spawn_blocking` awaited by the dialog).
- Dialog `client/src/components/menu/dialogs/import-url/index.tsx` (awaits the whole run).

**Sketch:** mirror the analyzer's job model — spawn the import on a background
thread, emit progress events (like `SetupProgress` / analysis queue status:
`per-entry {done, total, current title, failures}`), and let the dialog close after
kicking it off. Surface progress in the sidebar or a toast; report the final
`ImportReport` when done. Per-item atomicity already fits a streaming/queued model.
Ties in with T-002-style HUD only loosely — mostly backend job plumbing + an events
channel.
