import { arrayMove } from '@dnd-kit/sortable';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  addPartyQueueEntry,
  fetchPartyImports,
  fetchPartyQueue,
  fetchPartySongs,
  removePartyQueueEntry,
  reorderPartyQueue,
  submitPartyImport,
  type PartyEntry,
  type PartySong,
} from '@/bridge/party';

const PARTY_SONGS = ['party-songs'];
const PARTY_QUEUE = ['party-queue'];
const PARTY_IMPORTS = ['party-imports'];

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

/**
 * A phone hears nothing and feels nothing when the host accepts a change, and
 * the queue it changed may be on another tab, so a mutation that leaves this
 * screen looking the same says so with a toast.
 */
const useQueueMutation = <TInput>(
  mutationFn: (input: TInput) => Promise<PartyEntry[]>,
  failure: string,
  success?: (input: TInput) => string,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (entries, input) => {
      queryClient.setQueryData(PARTY_QUEUE, entries);

      if (success !== undefined) {
        toast.success(success(input));
      }
    },
    onError: (error: Error) => toast.error(`${failure}: ${error.message}`),
  });
};

export const useAddToPartyQueue = () =>
  useQueueMutation(
    (song: PartySong) => addPartyQueueEntry(song.file_hash),
    'Could not add that song',
    (song) => `Added ${song.title} to the queue`,
  );

/**
 * The host's import queue. Polled on the same interval as the playback queue
 * and for the same reason: the relay carries playback state only, and a
 * download moves without anything telling this page so.
 *
 * `null` data means the host has phone imports turned off.
 */
export const usePartyImports = () =>
  useQuery({
    queryKey: PARTY_IMPORTS,
    queryFn: fetchPartyImports,
    // A host with imports turned off answers the same way every time, so the
    // poll stops rather than asking a closed door every three seconds.
    refetchInterval: (data) => (data === null ? false : QUEUE_POLL_MS),
  });

/**
 * Whether the host accepts links from a phone at all. A 404 is the host saying
 * the door is shut, which is a different thing from an import having failed, so
 * the tab is not offered rather than being offered and refusing.
 */
export const usePartyImportAllowed = () => {
  const { data, isLoading } = usePartyImports();

  return !isLoading && data !== null && data !== undefined;
};

export const useSubmitPartyImport = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: submitPartyImport,
    onSuccess: (queued) => {
      void queryClient.invalidateQueries({ queryKey: PARTY_IMPORTS });
      toast.success(`Queued ${queued.title}`);
    },
    onError: (error: Error) => toast.error(`Could not queue that link: ${error.message}`),
  });
};

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
