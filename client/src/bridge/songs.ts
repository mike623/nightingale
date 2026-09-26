import type { AnalysisQueue } from '@/types/AnalysisQueue';
import type { LoadSongsParams } from '@/types/LoadSongsParams';
import type { Song } from '@/types/Song';
import type { SongsMeta } from '@/types/SongsMeta';
import type { SongsStore } from '@/types/SongsStore';

import { invoke } from './runtime';
import { songSchema } from './schemas';

export function getPreloadedSongsMeta(): SongsMeta | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return window.__NIGHTINGALE_SONGS_META__;
}

export const loadSongs = async (params: LoadSongsParams): Promise<SongsStore> => {
  return await invoke<SongsStore>('load_songs', { params });
};

export const loadSongsByHashes = async (fileHashes: string[]): Promise<Song[]> => {
  return await invoke<Song[]>('load_songs_by_hashes', { fileHashes });
};

export const loadSongsMeta = async (): Promise<SongsMeta> => {
  return await invoke<SongsMeta>('load_songs_meta');
};

export const loadAnalysisQueue = async (): Promise<AnalysisQueue> => {
  return await invoke<AnalysisQueue>('load_analysis_queue');
};

/**
 * Rewrite a local song's display name in the library database. Returns the
 * stored row so callers refresh from what was persisted, not what they sent.
 */
export const renameSong = async (
  fileHash: string,
  fields: { title?: string; artist?: string },
): Promise<Song> => {
  const value = await invoke('rename_song', {
    fileHash,
    title: fields.title,
    artist: fields.artist,
  });
  return songSchema.parse(value);
};
