import { CACHE_STATS, MENU, SONGS, SONGS_META, ANALYSIS_QUEUE } from "@/queries/keys";
import { clearAll, clearModels, clearVideos, sweepOrphanCache } from "@/bridge/cache";
import { formatBytes } from "@/utils/stats";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const useClearCache = () => {
  const queryClient = useQueryClient();

  const invalidate = (songsChanged: boolean) => {
    queryClient.invalidateQueries({ queryKey: CACHE_STATS });
    if (!songsChanged) return;
    // Clearing the songs cache resets every song to "not analyzed", so the
    // library views have to re-read rather than keep advertising stems.
    queryClient.invalidateQueries({ queryKey: MENU });
    queryClient.invalidateQueries({ queryKey: SONGS });
    queryClient.invalidateQueries({ queryKey: SONGS_META });
    queryClient.invalidateQueries({ queryKey: ANALYSIS_QUEUE });
  };

  const clearCacheFactory = (handler: () => Promise<void>, songsChanged = false) => {
    return async () => {
      try {
        await handler();
        invalidate(songsChanged);
        toast.info(`Cache was successfully cleared`);
      } catch (error: unknown) {
        toast.error(
          `Error while deleting cache: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    };
  };

  return {
    videos: clearCacheFactory(clearVideos),
    models: clearCacheFactory(clearModels),
    all: clearCacheFactory(clearAll, true),
    orphans: async () => {
      try {
        const report = await sweepOrphanCache();
        invalidate(false);
        toast.info(
          report.files === 0n
            ? "No orphaned cache files to clean up"
            : `Reclaimed ${formatBytes(report.bytes)} from ${report.files} orphaned file${report.files === 1n ? "" : "s"}`,
        );
      } catch (error: unknown) {
        toast.error(
          `Error while cleaning orphaned cache: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    },
  };
};
