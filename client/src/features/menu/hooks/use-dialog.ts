import { atom, useAtom } from 'jotai';

import type { Song } from '@/types/Song';

export type ClearCacheTarget = 'all' | 'videos' | 'models' | 'orphans';

export type DialogMode =
  | 'exit'
  | 'create-profile'
  | 'select-profile'
  | 'leaderboards'
  | 'about'
  | 'update'
  | 'donate'
  | 'clear-playback-queue'
  | 'folder-source-confirm'
  | 'jellyfin-connect'
  | 'navidrome-connect'
  | 'plex-connect'
  | { mode: 'language'; song: Song }
  | { mode: 'edit-lyrics'; song: Song }
  | { mode: 'song-leaderboard'; song: Song }
  | { mode: 'clear-cache'; target: ClearCacheTarget }
  // `onDeleted` closes the details sidebar: it keeps showing the last selected
  // song even after it drops out of the loaded pages, so a deleted song would
  // otherwise linger there as a ghost row.
  | { mode: 'delete-song'; song: Song; onDeleted: () => void }
  | null;

const dialogAtom = atom<DialogMode>(null);

export const useDialog = () => {
  const [mode, setMode] = useAtom(dialogAtom);

  return {
    mode,
    setMode,
    close: () => setMode(null),
  };
};
