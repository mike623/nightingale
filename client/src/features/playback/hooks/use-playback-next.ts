/**
 * Picks the next song to play and starts it.
 *
 * The draw itself lives in the application core: it is weighted by what the
 * room has already sung, so it needs the play history and the song rows in one
 * place. This hook only asks for a song and starts it.
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
import { usePlaybackTransportActions } from '@/features/playback/providers';
import type { Song } from '@/types/Song';

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

export function usePlaybackNext(currentFileHash: string): () => void {
  const navigate = useNavigate();
  const { handleExit } = usePlaybackTransportActions();
  // A press while a draw is in flight would start two songs; the flag is never
  // cleared after a successful start because this session is unmounting.
  const drawingRef = useRef(false);

  return useCallback(() => {
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
  }, [currentFileHash, handleExit, navigate]);
}
