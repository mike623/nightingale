/**
 * The phone's view of the host playback surface: published snapshots come in
 * over the same event bus as the queue, and the phone never owns a clock.
 *
 * The host publishes progress at 1 Hz while audio advances; the phone page
 * extrapolates position between publishes (see `useRemotePosition`).
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import {
  loadPlaybackOptions,
  loadPlaybackProgress,
  onPlaybackOptionsChanged,
  onPlaybackProgressChanged,
} from '@/bridge/playback-remote';
import { PLAYBACK_OPTIONS, PLAYBACK_PROGRESS } from '@/shared/query-keys';

export function useRemotePlayback() {
  const queryClient = useQueryClient();
  const { data: progress } = useQuery({
    queryKey: PLAYBACK_PROGRESS,
    queryFn: loadPlaybackProgress,
  });
  const { data: options } = useQuery({
    queryKey: PLAYBACK_OPTIONS,
    queryFn: loadPlaybackOptions,
  });

  useEffect(() => {
    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    void onPlaybackProgressChanged((next) => {
      queryClient.setQueryData(PLAYBACK_PROGRESS, next);
    }).then((fn) => {
      if (cancelled) {
        fn();
        return undefined;
      }
      unlisteners.push(fn);
      return undefined;
    });

    void onPlaybackOptionsChanged((next) => {
      queryClient.setQueryData(PLAYBACK_OPTIONS, next);
    }).then((fn) => {
      if (cancelled) {
        fn();
        return undefined;
      }
      unlisteners.push(fn);
      return undefined;
    });

    return () => {
      cancelled = true;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [queryClient]);

  return { progress, options };
}
