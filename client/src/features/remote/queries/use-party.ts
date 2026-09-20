import { arrayMove } from '@dnd-kit/sortable';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  addPartyQueueEntry,
  fetchPartyQueue,
  fetchPartySongs,
  removePartyQueueEntry,
  reorderPartyQueue,
  type PartyEntry,
} from '@/bridge/party';

const PARTY_SONGS = ['party-songs'];
const PARTY_QUEUE = ['party-queue'];

const PAGE_SIZE = 25;

/**
 * Other phones and the host screen all write to the same queue, so the page
 * polls while it is open rather than waiting for a change it cannot hear. The
 * relay carries playback state only; queue traffic is HTTP.
 */
const QUEUE_POLL_MS = 3000;

export const usePartySongs = (search: string) =>
  useInfiniteQuery({
    queryKey: [...PARTY_SONGS, search],
    queryFn: ({ pageParam = 0 }: { pageParam?: number }) =>
      fetchPartySongs({ search, skip: pageParam, take: PAGE_SIZE }),
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.songs.length, 0);

      return loaded < lastPage.total ? loaded : undefined;
    },
    keepPreviousData: true,
  });

export const usePartyQueue = () =>
  useQuery({
    queryKey: PARTY_QUEUE,
    queryFn: fetchPartyQueue,
    refetchInterval: QUEUE_POLL_MS,
  });

const useQueueMutation = <TInput>(
  mutationFn: (input: TInput) => Promise<PartyEntry[]>,
  failure: string,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (entries) => queryClient.setQueryData(PARTY_QUEUE, entries),
    onError: (error: Error) => toast.error(`${failure}: ${error.message}`),
  });
};

export const useAddToPartyQueue = () =>
  useQueueMutation(addPartyQueueEntry, 'Could not add that song');

export const useRemoveFromPartyQueue = () =>
  useQueueMutation(removePartyQueueEntry, 'Could not remove that song');

type ReorderInput = { id: string; toIndex: number };

/**
 * A dragged row settles where the finger left it rather than waiting for the
 * host to answer, and snaps back if the host refuses the move.
 */
export const useReorderPartyQueue = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, toIndex }: ReorderInput) => reorderPartyQueue(id, toIndex),
    onMutate: async ({ id, toIndex }: ReorderInput) => {
      await queryClient.cancelQueries({ queryKey: PARTY_QUEUE });

      const previous = queryClient.getQueryData<PartyEntry[]>(PARTY_QUEUE);

      if (previous !== undefined) {
        const from = previous.findIndex((entry) => entry.id === id);

        if (from !== -1) {
          queryClient.setQueryData(PARTY_QUEUE, arrayMove(previous, from, toIndex));
        }
      }

      return { previous };
    },
    onSuccess: (entries) => queryClient.setQueryData(PARTY_QUEUE, entries),
    onError: (error: Error, _input, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(PARTY_QUEUE, context.previous);
      }

      toast.error(`Could not move that song: ${error.message}`);
    },
  });
};
