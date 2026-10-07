import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { clearAll, clearModels, clearVideos, sweepOrphanCache } from '@/bridge/cache';
import { formatBytes } from '@/features/library/utils/stats';
import { ANALYSIS_QUEUE, CACHE_STATS, MENU, SONGS, SONGS_META } from '@/shared/query-keys';

export const useClearCache = () => {
  const queryClient = useQueryClient();

  const invalidate = (songsChanged: boolean) => {
    void queryClient.invalidateQueries({ queryKey: CACHE_STATS });
    if (!songsChanged) {
      return;
    }

    // Clearing the songs cache resets every song to "not analyzed", so the
    // library views have to re-read rather than keep advertising stems.
    void queryClient.invalidateQueries({ queryKey: MENU });
    void queryClient.invalidateQueries({ queryKey: SONGS });
    void queryClient.invalidateQueries({ queryKey: SONGS_META });
    void queryClient.invalidateQueries({ queryKey: ANALYSIS_QUEUE });
  };

  const clearCacheFactory = (handler: () => Promise<void>, songsChanged = false) => {
    return async () => {
      try {
        await handler();

        invalidate(songsChanged);

        toast.info(`Cache was successfully cleared`);
      } catch (error: unknown) {
        toast.error(
          `Error while deleting cache: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      }
    };
  };

  const sweepOrphans = async () => {
    try {
      const report = await sweepOrphanCache();

      invalidate(false);

      toast.info(
        report.files === 0n
          ? 'No orphaned cache files to clean up'
          : `Reclaimed ${formatBytes(report.bytes)} from ${report.files} orphaned file${
              report.files === 1n ? '' : 's'
            }`,
      );
    } catch (error: unknown) {
      toast.error(
        `Error while cleaning orphaned cache: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  };

  return {
    videos: clearCacheFactory(clearVideos),
    models: clearCacheFactory(clearModels),
    all: clearCacheFactory(clearAll, true),
    orphans: sweepOrphans,
  };
};
