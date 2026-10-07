/**
 * Names the lyrics a song is playing with, for the playback HUD.
 *
 * The label reports where the timing came from, which is what decides how far
 * it can be trusted: authored UltraStar and LRC timings are exact, while an
 * alignment or a transcription is inferred. Plain and Enhanced LRC stay
 * distinct because they carry different precision — line-level against
 * word-level.
 */

import type { Segment } from '@/types/Transcript';

/** Shown when the song plays with no lyrics at all. */
const NONE = 'none';

const hasWordTimings = (segments: readonly Segment[]): boolean =>
  segments.some((segment) => segment.words.some((word) => word.word.trim().length > 0));

export function transcriptLabel(source: string, segments: readonly Segment[]): string {
  if (segments.length === 0) {
    return NONE;
  }

  switch (source) {
    case 'usdx':
      return 'UltraStar';
    case 'lrc':
      return hasWordTimings(segments) ? 'Enhanced LRC' : 'LRC';
    case 'lyrics':
      return 'Aligned (AI)';
    default:
      return 'Generated (AI)';
  }
}
