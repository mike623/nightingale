import type { DialogMode } from '@/features/menu/hooks/use-dialog';
import type { Song } from '@/types/Song';
import type { Transcript } from '@/types/Transcript';

export type EditLyricsDialogMode = { mode: 'edit-lyrics'; song: Song };

export function isEditLyricsDialogMode(mode: DialogMode): mode is EditLyricsDialogMode {
  return mode !== null && typeof mode === 'object' && mode.mode === 'edit-lyrics';
}

export function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '?';
  }
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds) % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export function normalizeLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export type LrcLevel = 'none' | 'line' | 'word';

// `[mm:ss.xx]` line timestamp and `<mm:ss.xx>` word timestamp.
const LINE_TS = /\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/;
const WORD_TS = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/;

/**
 * Detect whether pasted text carries LRC timing. Returns "word" when any
 * `<...>` word-level timestamp is present, "line" when only `[...]` line
 * timestamps are, and "none" for plain lyrics.
 */
export function detectLrcLevel(text: string): LrcLevel {
  if (WORD_TS.test(text)) {
    return 'word';
  }
  if (LINE_TS.test(text)) {
    return 'line';
  }
  return 'none';
}

/** Strip all LRC/Enhanced LRC timestamp and metadata tags to plain lyric lines. */
export function stripLrcToPlainLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) =>
      line
        // Metadata tags like [ar:...] / [ti:...] / [offset:...].
        .replace(/\[[a-z]+:[^\]]*\]/gi, '')
        // Line timestamps `[mm:ss.xx]` (possibly repeated).
        .replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '')
        // Word timestamps `<mm:ss.xx>`.
        .replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '')
        .trim(),
    )
    .filter((line) => line.length > 0);
}

export function linesFromTranscript(transcript: Transcript): string {
  return transcript.segments
    .map((s) => s.text.trim())
    .filter((s) => s.length > 0)
    .join('\n');
}

/** Timestamp tag bodies: `mm:ss`, optionally `.xx` / `:xx` fractions. */
const LINE_TS_PARTS = /\[(\d{1,3}):(\d{1,2})(?:([.:])(\d{1,3}))?\]/g;
const WORD_TS_PARTS = /<(\d{1,3}):(\d{1,2})(?:([.:])(\d{1,3}))?>/g;

/**
 * Re-render a timestamp shifted by `deltaSeconds`, keeping the tag's own
 * precision: a `mm:ss.xx` tag stays hundredths, a `mm:ss.xxx` tag stays
 * milliseconds. Times cannot go negative, so an earlier shift clamps at zero.
 */
function shiftTimestamp(
  minutes: string,
  seconds: string,
  fraction: string | undefined,
  deltaSeconds: number,
): { minutes: string; seconds: string; fraction: string | undefined } {
  const digits = fraction?.length ?? 0;
  const scale = 10 ** digits;
  const current = (Number(minutes) * 60 + Number(seconds)) * scale + Number(fraction ?? 0);
  const shifted = Math.max(0, Math.round(current + deltaSeconds * scale));

  const wholeSeconds = Math.floor(shifted / scale);
  return {
    minutes: String(Math.floor(wholeSeconds / 60)).padStart(minutes.length, '0'),
    seconds: String(wholeSeconds % 60).padStart(seconds.length, '0'),
    fraction: fraction === undefined ? undefined : String(shifted % scale).padStart(digits, '0'),
  };
}

/**
 * Shift every line (`[mm:ss.xx]`) and word (`<mm:ss.xx>`) timestamp in LRC text
 * by `deltaSeconds`, leaving lyric text, metadata tags, and layout untouched.
 */
export function shiftLrcTimestamps(text: string, deltaSeconds: number): string {
  const rewrite = (pattern: RegExp, open: string, close: string, input: string): string =>
    input.replace(pattern, (_match: string, ...groups: (string | undefined)[]) => {
      const [minutes = '0', seconds = '0', separator, fraction] = groups;
      const shifted = shiftTimestamp(minutes, seconds, fraction, deltaSeconds);
      const tail = shifted.fraction === undefined ? '' : `${separator ?? '.'}${shifted.fraction}`;
      return `${open}${shifted.minutes}:${shifted.seconds}${tail}${close}`;
    });

  return rewrite(WORD_TS_PARTS, '<', '>', rewrite(LINE_TS_PARTS, '[', ']', text));
}
