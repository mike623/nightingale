import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { renameSong } from '@/bridge/songs';
import { MENU, SONGS, SONGS_META } from '@/shared/query-keys';
import type { Song } from '@/types/Song';

/** A renamed song moves between artist groups and sort positions, so the
 * library views and the artist/album menu both have to re-read. */
export const useRenameSong = () => {
  const queryClient = useQueryClient();

  return async (song: Song, fields: { title?: string; artist?: string }): Promise<void> => {
    try {
      await renameSong(song.file_hash, fields);
      void queryClient.invalidateQueries({ queryKey: SONGS });
      void queryClient.invalidateQueries({ queryKey: SONGS_META });
      void queryClient.invalidateQueries({ queryKey: MENU });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Renaming the song failed.');
    }
  };
};
