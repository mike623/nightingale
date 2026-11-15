/**
 * Loads the transcript for the current track and normalizes segments for display.
 *
 * Kept in the query cache under `TRANSCRIPT` so that saving lyrics mid-song
 * refreshes the running playback: the lyrics mutations invalidate that key and
 * the new timing replaces the old segments in place.
 */

import { useQuery } from '@tanstack/react-query';

import { loadTranscript } from '@/bridge/playback';
import { splitLongSegments } from '@/features/playback/utils/transcript-segments';
import { t } from '@/i18n';
import { TRANSCRIPT } from '@/shared/query-keys';
import type { Segment, Transcript } from '@/types/Transcript';

export type PlaybackTranscript = {
  segments: Segment[];
  transcriptSource: string;
  isReady: boolean;
  error: string | null;
};

type LoadedTranscript = Pick<PlaybackTranscript, 'segments' | 'transcriptSource'>;

const NO_SEGMENTS: Segment[] = [];

/**
 * Module-level so the query cache can memoize the result: playback consumers
 * re-render per frame and must not see a new `segments` array each time.
 */
const toPlaybackTranscript = (transcript: Transcript | null | undefined): LoadedTranscript => {
  // The host returns whatever JSON the cache holds. A transcript without a
  // segment list has no timed words to show, which is a lyric-less song rather
  // than a failed load, so it plays with an empty lyrics track.
  const segments: unknown = transcript?.segments;
  return {
    segments: Array.isArray(segments) ? splitLongSegments(transcript?.segments ?? []) : NO_SEGMENTS,
    transcriptSource: transcript?.source ?? 'generated',
  };
};

const loadErrorMessage = (reason: unknown): string =>
  t('playback.lyrics.loadError', {
    error: reason instanceof Error ? reason.message : String(reason),
  });

export function usePlaybackTranscript(fileHash: string): PlaybackTranscript {
  const { data, error } = useQuery({
    queryKey: [...TRANSCRIPT, fileHash],
    queryFn: () => loadTranscript(fileHash),
    select: toPlaybackTranscript,
    staleTime: Infinity,
  });

  return {
    segments: data?.segments ?? NO_SEGMENTS,
    transcriptSource: data?.transcriptSource ?? 'generated',
    isReady: data !== undefined,
    error: error === null ? null : loadErrorMessage(error),
  };
}
