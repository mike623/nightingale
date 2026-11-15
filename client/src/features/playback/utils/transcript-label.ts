/**
 * Names the lyrics a song is playing with, for the playback HUD.
 *
 * The label reports where the timing came from, which is what decides how far
 * it can be trusted: authored UltraStar and LRC timings are exact, while an
 * alignment or a transcription is inferred. Plain and Enhanced LRC stay
 * distinct because they carry different precision — line-level against
 * word-level.
 */

import type { TranslationKey } from '@/i18n';
import type { Segment } from '@/types/Transcript';

const hasWordTimings = (segments: readonly Segment[]): boolean =>
  segments.some((segment) => segment.words.some((word) => word.word.trim().length > 0));

export function transcriptLabel(source: string, segments: readonly Segment[]): TranslationKey {
  if (segments.length === 0) {
    return 'playback.transcriptLabel.none';
  }

  switch (source) {
    case 'usdx':
      return 'playback.transcriptLabel.ultrastar';
    case 'lrc':
      return hasWordTimings(segments)
        ? 'playback.transcriptLabel.enhancedLrc'
        : 'playback.transcriptLabel.lrc';
    case 'lyrics':
      return 'playback.transcriptLabel.aligned';
    default:
      return 'playback.transcriptLabel.generated';
  }
}
