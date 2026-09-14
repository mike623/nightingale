/**
 * Picks the next song to play and starts it.
 *
 * Selection is a uniform random draw over the analyzed (playable) songs:
 * `load_songs_meta` gives the population size and `load_songs` fetches the one
 * row at a random offset, so no song list is ever held in memory here.
 *
 * Starting the new song is all the teardown that is needed — the route shell
 * keys `PlaybackInner` by the song hash, and unmounting the old session closes
 * its AudioContext.
 */

import { useCallback, useRef } from 'react';
import { useNavigate, type NavigateFunction } from 'react-router';
import { toast } from 'sonner';

import { isSessionPlayback, savePlaybackSession } from '@/bridge/playback-session';
import { loadSongs, loadSongsMeta } from '@/bridge/songs';
import { usePlaybackTransportActions } from '@/features/playback/providers';
import type { Song } from '@/types/Song';

async function analyzedSongAt(skip: number): Promise<Song | null> {
  const page = await loadSongs({
    search: null,
    filters: {
      artist: null,
      album: null,
      playlist: null,
      query: null,
      status: 'analyzed',
      transcript_source: null,
      search: null,
    },
    sort: null,
    skip,
    take: 1,
  });

  return page.processed[0] ?? null;
}

/**
 * Draws a random analyzed song other than `currentFileHash`. Returns `null`
 * when the library has no other playable song.
 */
async function pickRandomSong(currentFileHash: string): Promise<Song | null> {
  const { analyzed_count: count } = await loadSongsMeta();
  if (count === 0) {
    return null;
  }

  const skip = Math.floor(Math.random() * count);
  // The count and the row come from two calls, so a library that shrank in
  // between can leave the offset past the end; the first row always exists.
  const song = (await analyzedSongAt(skip)) ?? (await analyzedSongAt(0));

  // The draw can land on the song that just played. Stepping one row over is
  // cheaper than re-drawing until it differs, and the offset is stable.
  if (song !== null && song.file_hash === currentFileHash) {
    return count > 1 ? await analyzedSongAt((skip + 1) % count) : null;
  }

  return song;
}

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
        const song = await pickRandomSong(currentFileHash);

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
