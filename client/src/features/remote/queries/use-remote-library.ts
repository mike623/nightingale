import { useQueries, useQuery } from '@tanstack/react-query';

import { loadSongs } from '@/bridge/songs';
import { SONGS } from '@/shared/query-keys';
import type { LibraryMenuFilters } from '@/types/LibraryMenuFilters';
import type { Song } from '@/types/Song';

const PAGE_SIZE = 25;

// Only analyzed songs can be queued, so the phone is not offered the rest.
const ANALYZED_ONLY: LibraryMenuFilters = {
  artist: null,
  album: null,
  playlist: null,
  query: null,
  status: 'analyzed',
  transcript_source: null,
  search: null,
  folder: null,
};

const pageOf = (index: number) => Math.floor(index / PAGE_SIZE);

const songPageQuery = (search: string, page: number) => ({
  queryKey: [...SONGS, 'remote-library', search, page],
  queryFn: () =>
    loadSongs({
      search: search.length > 0 ? search : null,
      filters: ANALYZED_ONLY,
      sort: null,
      skip: page * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  // A search is retyped a character at a time, so the list a guest is reading
  // stays on screen until the results for what they finished typing arrive.
  keepPreviousData: true,
});

/** How many songs match. The first page carries the count. */
export const useRemoteLibrarySize = (search: string) => {
  const { data, isLoading, error } = useQuery(songPageQuery(search, 0));

  return { total: data?.processed_count ?? 0, isLoading, error };
};

/**
 * The songs behind a window of rows, by position in the whole library. Only
 * the pages the window covers are fetched.
 */
export const useRemoteLibraryWindow = (search: string, start: number, end: number) => {
  const firstPage = pageOf(start);
  const lastPage = pageOf(Math.max(end - 1, start));
  const results = useQueries({
    queries: Array.from({ length: lastPage - firstPage + 1 }, (_, offset) =>
      songPageQuery(search, firstPage + offset),
    ),
  });

  return (index: number): Song | undefined => {
    const page = pageOf(index) - firstPage;

    return page >= 0 && page < results.length
      ? results[page].data?.processed.at(index % PAGE_SIZE)
      : undefined;
  };
};
