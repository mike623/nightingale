import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { applyTimedLyrics, clearLyrics, provideLrc } from '@/bridge/lyrics';
import { ANALYSIS_QUEUE, LYRICS, MENU, SONGS, SONGS_META, TRANSCRIPT } from '@/shared/query-keys';

const LYRICS_QUERY_KEYS = [LYRICS, TRANSCRIPT, MENU, SONGS, SONGS_META, ANALYSIS_QUEUE];

const invalidateLyricsQueries = (queryClient: ReturnType<typeof useQueryClient>) => {
  for (const key of LYRICS_QUERY_KEYS) {
    void queryClient.invalidateQueries({ queryKey: key });
  }
};

export type ProvideLrcInput = {
  hash: string;
  lrcText: string;
  separateStems: boolean;
  title: string;
};

export const useProvideLrcMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ hash, lrcText, separateStems, title }: ProvideLrcInput) => {
      await provideLrc(hash, lrcText, separateStems);
      toast.info(
        separateStems ? `Separating stems for "${title}"` : `Saved timed lyrics for "${title}"`,
      );
    },
    onSuccess: () => invalidateLyricsQueries(queryClient),
    onError: (error: Error) => {
      toast.error(`Error while providing lyrics: ${error.message}`);
    },
  });
};

export type ApplyTimedLyricsInput = {
  hash: string;
  lrcText: string;
  title: string;
};

export const useApplyTimedLyricsMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ hash, lrcText, title }: ApplyTimedLyricsInput) => {
      await applyTimedLyrics(hash, lrcText);
      toast.info(`Applied timed lyrics to "${title}"`);
    },
    onSuccess: () => invalidateLyricsQueries(queryClient),
    onError: (error: Error) => {
      toast.error(`Error while applying timed lyrics: ${error.message}`);
    },
  });
};

export type ClearLyricsInput = {
  hash: string;
  title: string;
};

export const useClearLyricsMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ hash, title }: ClearLyricsInput) => {
      await clearLyrics(hash);
      toast.info(`Removed lyrics from "${title}"`);
    },
    onSuccess: () => invalidateLyricsQueries(queryClient),
    onError: (error: Error) => {
      toast.error(`Error while removing lyrics: ${error.message}`);
    },
  });
};
