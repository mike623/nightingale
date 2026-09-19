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
import { TRANSCRIPT } from '@/shared/query-keys';
import type { Segment, Transcript } from '@/types/Transcript';

export type PlaybackTranscript = {
  segments: Segment[];
  transcriptSource: string;
};

/**
 * Module-level so the query cache can memoize the result: playback consumers
 * re-render per frame and must not see a new `segments` array each time.
 */
const toPlaybackTranscript = (transcript: Transcript): PlaybackTranscript => ({
  segments: splitLongSegments(transcript.segments),
  transcriptSource: transcript.source ?? 'generated',
});

const NO_TRANSCRIPT: PlaybackTranscript = { segments: [], transcriptSource: 'generated' };

export function usePlaybackTranscript(fileHash: string): PlaybackTranscript {
  const { data } = useQuery({
    queryKey: [...TRANSCRIPT, fileHash],
    queryFn: () => loadTranscript(fileHash),
    select: toPlaybackTranscript,
    staleTime: Infinity,
  });

  return data ?? NO_TRANSCRIPT;
}
