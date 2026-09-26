import type { Song } from '@/types/Song';

import { invoke } from './runtime';
import { songSchema } from './schemas';

/**
 * Records how one playback run ended. `sung` is true only for a run that
 * scored above zero; everything else counts as a skip and makes the song
 * likelier to come round again.
 */
export const recordSongPlay = async (fileHash: string, sung: boolean): Promise<void> => {
  await invoke('record_song_play', { fileHash, sung });
};

/**
 * Draws the next analyzed song, weighted towards the ones the room has sung
 * least. Resolves to `null` when the library holds no other analyzed song.
 */
export const pickNextSong = async (excludeFileHash: string | null): Promise<Song | null> => {
  const value = await invoke('pick_next_song', { excludeFileHash });
  return value === null || value === undefined ? null : songSchema.parse(value);
};
