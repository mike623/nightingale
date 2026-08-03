# Lyrics default to LRCLIB line-level; word-level is opt-in

WhisperX does two jobs during analysis: transcribe lyrics when none are known, and align known lyrics to **word-level** timestamps for per-word karaoke highlighting. It is the slow, GPU-hungry part of the pipeline. LRCLIB already returns **line-level** synced lyrics (LRC) for many songs, for free.

We decided analysis defaults to **line-level and never runs WhisperX**:
- LRCLIB has a synced match → use it directly (via the existing `provide_lrc` stems-only path), skip WhisperX.
- LRCLIB has **no** synced match → separate stems only, **no transcription** — the song is left **lyric-less** (instrumental karaoke, no words) rather than paying for a slow, often-inaccurate ASR pass on a messy track.

`config.word_level_lyrics` (default off) opts back in to always-align word-level; the per-song `reanalyze_force_transcribe` forces it for one song; and the Edit Lyrics dialog's LRCLIB search box lets the user find lyrics by hand when the auto-derived title/artist are wrong. Vocal separation (the karaoke instrumental) always runs regardless.

Consequences: by default, songs LRCLIB doesn't cover get no synced lyrics until the user searches LRCLIB manually or enables word-level. Karaoke highlights whole lines, not words, for covered songs. WhisperX — the slow, GPU-hungry step — runs only on explicit opt-in.
