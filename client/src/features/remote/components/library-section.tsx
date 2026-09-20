import { ListPlusIcon, SearchIcon } from 'lucide-react';
import { useState } from 'react';

import type { PartySong } from '@/bridge/party';
import { errorMessage } from '@/features/remote/lib/error-message';
import { TOUCH_TARGET } from '@/features/remote/lib/touch-target';
import { useAddToPartyQueue, usePartySongs } from '@/features/remote/queries/use-party';
import { Button } from '@/shared/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/components/ui/empty';
import { Input } from '@/shared/components/ui/input';
import { Spinner } from '@/shared/components/ui/spinner';
import { cn } from '@/shared/utils/cn';
import { formatSeconds } from '@/shared/utils/format-duration';

type SongRowProps = {
  song: PartySong;
  onAdd: (fileHash: string) => void;
  adding: boolean;
};

const SongRow = ({ song, onAdd, adding }: SongRowProps) => (
  <li className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0">
    <div className="min-w-0">
      <p className="truncate text-sm font-medium">{song.title}</p>
      <p className="truncate text-xs text-muted-foreground">
        {song.artist} · {formatSeconds(song.duration_secs)}
        {!song.is_analyzed && ' · not analyzed yet'}
      </p>
    </div>

    <Button
      aria-label={`Add ${song.title} to the queue`}
      className={cn(TOUCH_TARGET, 'shrink-0')}
      disabled={adding}
      onClick={() => onAdd(song.file_hash)}
      type="button"
      variant="outline"
    >
      <ListPlusIcon />
      Add
    </Button>
  </li>
);

const NoResults = ({ searching }: { searching: boolean }) => (
  <Empty>
    <EmptyHeader>
      <EmptyTitle>No songs found</EmptyTitle>
      <EmptyDescription>
        {searching ? 'Try a different search.' : 'The host has no songs in its library yet.'}
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

const SongResults = ({ search }: { search: string }) => {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, error } =
    usePartySongs(search);
  const { mutate: add, isLoading: adding } = useAddToPartyQueue();

  if (isLoading) {
    return (
      <output aria-live="polite" className="flex justify-center py-6">
        <Spinner />
      </output>
    );
  }

  if (error !== null) {
    return (
      <p aria-live="polite" className="text-sm text-destructive">
        The library could not be read: {errorMessage(error)}
      </p>
    );
  }

  const songs = data?.pages.flatMap((page) => page.songs) ?? [];

  if (songs.length === 0) {
    return <NoResults searching={search.length > 0} />;
  }

  return (
    <>
      <ul className="rounded-md border px-3">
        {songs.map((song) => (
          <SongRow adding={adding} key={song.file_hash} onAdd={add} song={song} />
        ))}
      </ul>

      {hasNextPage === true && (
        <Button
          className={cn(TOUCH_TARGET, 'mt-3 w-full')}
          disabled={isFetchingNextPage}
          onClick={() => void fetchNextPage()}
          type="button"
          variant="outline"
        >
          {isFetchingNextPage ? 'Loading' : 'Show more'}
        </Button>
      )}
    </>
  );
};

/**
 * The library as a phone sees it: a search box, a page of results, and one
 * action. Adding is the only thing a guest may do to the library — nothing
 * here renames, deletes, or plays a song directly.
 */
export const LibrarySection = () => {
  const [search, setSearch] = useState('');

  return (
    <section aria-label="Library" className="space-y-3">
      <div className="relative">
        <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search the library"
          className="h-12 pl-9"
          enterKeyHint="search"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search songs"
          type="search"
          value={search}
        />
      </div>

      <SongResults search={search.trim()} />
    </section>
  );
};
