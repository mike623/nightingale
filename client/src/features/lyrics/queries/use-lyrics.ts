import { useQuery } from '@tanstack/react-query';

import { loadLyrics, searchLrclibLyrics } from '@/bridge/lyrics';
import { loadTranscript } from '@/bridge/playback';
import { linesFromTranscript, lrcFromTranscript } from '@/features/lyrics/utils/edit-lyrics';
import { LRCLIB, LYRICS } from '@/shared/query-keys';
import type { LrclibCandidate } from '@/types/LrclibCandidate';

/**
 * An analyzed song's transcript is the timing it actually plays with, so the
 * editor opens on it as Enhanced LRC: the timestamps are visible and can be
 * shifted. The plain lyrics sidecar is the fallback for songs with no
 * transcript yet (not analyzed, or realignment still queued).
 */
const fetchInitialLyrics = async (fileHash: string): Promise<string> => {
  const transcript = await loadTranscript(fileHash).catch(() => null);
  if (transcript !== null) {
    const lrc = lrcFromTranscript(transcript);
    if (lrc.length > 0) {
      return lrc;
    }
  }

  const file = await loadLyrics(fileHash);
  if (file && file.lines.length > 0) {
    return file.lines.join('\n');
  }

  return transcript === null ? '' : linesFromTranscript(transcript);
};

const requireFileHash = (fileHash: string | null): string => {
  if (fileHash === null) {
    throw new Error('Lyrics query requires a file hash');
  }
  return fileHash;
};

export const useInitialLyrics = (fileHash: string | null) =>
  useQuery({
    queryKey: [...LYRICS, fileHash],
    queryFn: () => fetchInitialLyrics(requireFileHash(fileHash)),
    enabled: fileHash !== null,
    staleTime: Infinity,
  });

export const useLrclibCandidates = (fileHash: string | null) =>
  useQuery<LrclibCandidate[]>({
    queryKey: [...LRCLIB, fileHash],
    queryFn: () => searchLrclibLyrics(requireFileHash(fileHash)),
    enabled: fileHash !== null,
    staleTime: Infinity,
  });
