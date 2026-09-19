/**
 * Records how the current playback run ended, so the next-song draw can lean
 * towards songs the room has not sung yet.
 *
 * The run ends when this session unmounts — the route shell keys the session
 * by song hash, so leaving, skipping to another song, and finishing all land
 * here through the same path. That is why the outcome is written from an
 * effect cleanup rather than from each of those call sites: one exit point
 * cannot double-count, and cannot miss one of them either.
 *
 * A run that never started playing (stems failed, or the user left during the
 * load) is not recorded: the song was never offered, so counting it as skipped
 * would push it down for something the singer never saw.
 */

import { useCallback, useEffect, useRef } from 'react';

import { recordSongPlay } from '@/bridge/play-history';
import {
  usePlaybackMicState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';

export function usePlaybackHistory(fileHash: string): void {
  const { isReady } = usePlaybackTransportState();
  const { getCurrentTime } = usePlaybackTransportActions();
  const { rawScore } = usePlaybackMicState();

  const runRef = useLatestRef({ isReady, rawScore, getCurrentTime });
  const recordedRef = useRef(false);

  // Reads the run's final state when called, not when defined, so the cleanup
  // below sees the score the singer actually finished on.
  const recordRun = useCallback(() => {
    const { isReady: started, rawScore: score, getCurrentTime: currentTime } = runRef.current;

    if (recordedRef.current || !started || currentTime() <= 0) {
      return;
    }

    recordedRef.current = true;
    void recordSongPlay(fileHash, score > 0).catch(() => {
      // History is a ranking hint, not user data: a failed write must never
      // interrupt leaving a song.
    });
  }, [fileHash, runRef]);

  useEffect(() => {
    recordedRef.current = false;

    return recordRun;
  }, [recordRun]);
}
