/**
 * Picks the next song to play and starts it.
 *
 * The queue decides: while it holds entries, advancing consumes its head, so a
 * room that queued songs hears them in the order it chose. The weighted random
 * draw is the fallback for an empty queue. That draw lives in the application
 * core, because it is weighted by what the room has already sung and so needs
 * the play history and the song rows in one place.
 *
 * Starting the new song is all the teardown that is needed — the route shell
 * keys `PlaybackInner` by the song hash, and unmounting the old session closes
 * its AudioContext.
 */

import { useCallback, useRef } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router';
import { toast } from 'sonner';

import { pickNextSong } from '@/bridge/play-history';
import { isSessionPlayback, savePlaybackSession } from '@/bridge/playback-session';
import {
  usePlaybackQueueQuery,
  useStartNextPlaybackQueueSong,
} from '@/features/playback-queue/use-playback-queue';
import { usePlaybackTransportActions } from '@/features/playback/providers';
import type { Song } from '@/types/Song';

export type PlaybackNext = {
  /** Starts the queue's head, or a random draw when the queue is empty. */
  playNext: () => void;
  /** True when the next advance consumes the queue instead of drawing. */
  hasQueueNext: boolean;
  /** True while a queued song is being prepared. */
  isPreparing: boolean;
};

/**
 * Session playback swaps the song in shared state and lets the broadcast
 * remount the playback window; classic playback re-enters the route.
 */
async function startSong(song: Song, navigate: NavigateFunction): Promise<void> {
  if (isSessionPlayback()) {
    await savePlaybackSession({ song, queuePlayback: false });
    return;
  }
  await navigate('/playback', { state: { song }, replace: true });
}

export function usePlaybackNext(currentFileHash: string): PlaybackNext {
  const navigate = useNavigate();
  const { handleExit } = usePlaybackTransportActions();
  const { data: entries = [] } = usePlaybackQueueQuery();
  const { playNext: playQueueNext, isPreparing } = useStartNextPlaybackQueueSong(entries);
  // A press while a draw is in flight would start two songs; the flag is never
  // cleared after a successful start because this session is unmounting.
  const drawingRef = useRef(false);
  const hasQueueNext = entries.length > 0;

  const playNext = useCallback(() => {
    if (hasQueueNext) {
      playQueueNext();
      return;
    }

    if (drawingRef.current) {
      return;
    }
    drawingRef.current = true;

    void (async () => {
      try {
        const song = await pickNextSong(currentFileHash);

        if (song === null) {
          toast.info('No other analyzed song to play next');
          handleExit();
          return;
        }

        await startSong(song, navigate);
      } catch (e) {
        toast.error(`Could not pick the next song: ${e instanceof Error ? e.message : String(e)}`);
        drawingRef.current = false;
      }
    })();
  }, [currentFileHash, handleExit, hasQueueNext, navigate, playQueueNext]);

  return { playNext, hasQueueNext, isPreparing };
}
