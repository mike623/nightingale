import type { DialogMode } from '@/features/menu/hooks/use-dialog';
import type { Song } from '@/types/Song';
import type { Segment, Transcript } from '@/types/Transcript';

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

/**
 * `mm:ss.xxx` timestamp. Milliseconds rather than the more common hundredths:
 * transcript times are seconds as floats, and the LRC parser accepts three
 * fractional digits, so rounding coarser would drop alignment precision.
 */
function lrcTimestamp(seconds: number): string {
  const total = Math.round(Math.max(0, seconds) * 1000);
  const wholeSeconds = Math.floor(total / 1000);
  const minutes = String(Math.floor(wholeSeconds / 60)).padStart(2, '0');
  const secs = String(wholeSeconds % 60).padStart(2, '0');
  return `${minutes}:${secs}.${String(total % 1000).padStart(3, '0')}`;
}

/**
 * Render a segment as one Enhanced LRC line, or as a plain line-level one when
 * the segment carries no word timings.
 *
 * Word tags are separated the way the segment's own text is: a space for
 * space-delimited scripts, nothing for scripts that don't space their words, so
 * re-parsing the line cannot inject whitespace the lyrics never had.
 */
function lrcLineFromSegment(segment: Segment): string | null {
  const head = `[${lrcTimestamp(segment.start)}]`;
  const words = segment.words.filter((word) => word.word.trim().length > 0);

  if (words.length === 0) {
    const text = segment.text.trim();
    return text.length === 0 ? null : `${head}${text}`;
  }

  const separator = segment.text.includes(' ') ? ' ' : '';
  return head + words.map((w) => `<${lrcTimestamp(w.start)}>${w.word.trim()}`).join(separator);
}

/**
 * Render a transcript as Enhanced LRC so the editor can show, and shift, the
 * timing a song is actually playing with.
 */
export function lrcFromTranscript(transcript: Transcript): string {
  return transcript.segments
    .map(lrcLineFromSegment)
    .filter((line) => line !== null)
    .join('\n');
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

/**
 * Words of an LRCLIB search field, offered as one-click replacements. A
 * derived title such as a raw YouTube video name usually carries the real
 * track or artist plus noise, so picking one word beats retyping the field.
 * A single-word value has nothing to narrow down.
 */
export function searchWordChips(value: string): string[] {
  const words = Array.from(new Set(value.split(/\s+/).filter((word) => word.length > 0)));
  return words.length > 1 ? words : [];
}
