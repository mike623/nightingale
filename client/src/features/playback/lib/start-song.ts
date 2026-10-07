/**
 * Starting one song, for the surfaces that choose one.
 *
 * Session playback swaps the song in shared state and lets the broadcast
 * remount the playback window; classic playback enters the route. Both ways of
 * starting a song live here so a caller only has to know which song it wants.
 */

import type { NavigateFunction } from 'react-router';

import { isSessionPlayback, savePlaybackSession } from '@/bridge/playback-session';
import type { Song } from '@/types/Song';

export async function startSong(song: Song, navigate: NavigateFunction): Promise<void> {
  if (isSessionPlayback()) {
    await savePlaybackSession({ song, queuePlayback: false });
    return;
  }

  await navigate('/playback', { state: { song }, replace: true });
}
