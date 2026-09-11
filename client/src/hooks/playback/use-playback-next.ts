/**
 * Picks the next song to play and navigates to it.
 *
 * Selection is a uniform random draw over the analyzed (playable) songs:
 * `load_songs_meta` gives the population size and `load_songs` fetches the one
 * row at a random offset, so no song list is ever held in memory here.
 *
 * Navigating to `/playback` with a new song is all the teardown that is
 * needed — the route mounts `PlaybackInner` under a `key` of the song hash, and
 * unmounting the old session closes its AudioContext.
 */

import { loadSongs, loadSongsMeta } from "@/bridge/songs";
import type { Song } from "@/types/Song";
import { useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

async function analyzedSongAt(skip: number): Promise<Song | null> {
  const page = await loadSongs({
    search: null,
    filters: {
      artist: null,
      album: null,
      playlist: null,
      query: null,
      status: "analyzed",
      transcript_source: null,
      search: null,
    },
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
  if (song?.file_hash === currentFileHash) {
    return count > 1 ? await analyzedSongAt((skip + 1) % count) : null;
  }

  return song;
}

export function usePlaybackNext(currentFileHash: string): () => void {
  const navigate = useNavigate();
  // A press while a draw is in flight would navigate twice; the flag is never
  // cleared after a successful navigation because this session is unmounting.
  const drawingRef = useRef(false);

  return useCallback(() => {
    if (drawingRef.current) {
      return;
    }
    drawingRef.current = true;

    void (async () => {
      try {
        const song = await pickRandomSong(currentFileHash);

        if (!song) {
          toast.info("No other analyzed song to play next");
          navigate("/", { replace: true });
          return;
        }

        navigate("/playback", { state: { song }, replace: true });
      } catch (e) {
        toast.error(`Could not pick the next song: ${e instanceof Error ? e.message : String(e)}`);
        drawingRef.current = false;
      }
    })();
  }, [currentFileHash, navigate]);
}
