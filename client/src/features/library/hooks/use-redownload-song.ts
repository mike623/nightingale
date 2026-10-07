import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { redownloadSong } from '@/bridge/import';
import { ANALYSIS_QUEUE, MENU, SONGS, SONGS_META } from '@/shared/query-keys';
import type { Song } from '@/types/Song';

/**
 * Download a song's YouTube video again over the file on disk.
 *
 * The download takes as long as it takes, so the toast stays until it lands.
 * The song comes back under a new hash — its bytes changed — which every
 * library view keys by, and analysis may have been dropped and re-queued.
 */
export const useRedownloadSong = () => {
  const queryClient = useQueryClient();

  return async (song: Song): Promise<void> => {
    const toastId = toast.loading(`Re-downloading “${song.title}”…`);

    try {
      const updated = await redownloadSong(song.file_hash);

      void queryClient.invalidateQueries({ queryKey: SONGS });
      void queryClient.invalidateQueries({ queryKey: SONGS_META });
      void queryClient.invalidateQueries({ queryKey: MENU });
      void queryClient.invalidateQueries({ queryKey: ANALYSIS_QUEUE });

      toast.success(
        updated.is_analyzed
          ? `Re-downloaded “${updated.title}”`
          : `Re-downloaded “${updated.title}” — analyzing again`,
        { id: toastId },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Re-downloading the song failed.', {
        id: toastId,
      });
    }
  };
};
