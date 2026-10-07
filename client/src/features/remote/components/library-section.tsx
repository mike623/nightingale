import { ListPlusIcon, SearchIcon } from 'lucide-react';
import { useState } from 'react';

import type { PartySong } from '@/bridge/party';
import { useVirtualRows } from '@/features/remote/hooks/use-virtual-rows';
import { errorMessage } from '@/features/remote/lib/error-message';
import { TOUCH_FIELD, TOUCH_TARGET } from '@/features/remote/lib/touch-target';
import {
  useAddToPartyQueue,
  usePartyLibrarySize,
  usePartyLibraryWindow,
} from '@/features/remote/queries/use-party';
import { Button } from '@/shared/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/components/ui/empty';
import { Input } from '@/shared/components/ui/input';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Spinner } from '@/shared/components/ui/spinner';
import { cn } from '@/shared/utils/cn';
import { formatSeconds } from '@/shared/utils/format-duration';

/**
 * Every row is the same height: a line of title over a line of detail beside a
 * fingertip-sized button. Stated in `rem` so the list follows the reader's text
 * size, and matched by the `h-16` the rows carry.
 */
const ROW_HEIGHT_REM = 4;

const OVERSCAN_ROWS = 8;

const ROW_LAYOUT = 'flex h-full min-w-0 items-center justify-between gap-3 px-3';

type SongRowProps = {
  song: PartySong;
  onAdd: (song: PartySong) => void;
  adding: boolean;
};

const SongRow = ({ song, onAdd, adding }: SongRowProps) => (
  <div className={ROW_LAYOUT}>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium">{song.title}</p>
      <p className="truncate text-xs text-muted-foreground">
        {song.artist} · {formatSeconds(song.duration_secs)}
        {!song.is_analyzed && ' · not analyzed yet'}
      </p>
    </div>

    <Button
      aria-label={`Add ${song.title} to the queue`}
      className={cn(TOUCH_TARGET, 'shrink-0 px-3')}
      disabled={adding}
      onClick={() => onAdd(song)}
      type="button"
      variant="outline"
    >
      <ListPlusIcon />
      <span className="sr-only sm:not-sr-only">Add</span>
    </Button>
  </div>
);

/**
 * A row the host has not sent yet. The library states its own length, so a row
 * can be scrolled to before the page holding it has arrived.
 */
const PendingRow = () => (
  <div className={ROW_LAYOUT}>
    <div className="min-w-0 flex-1 space-y-2">
      <Skeleton className="h-3.5 w-2/5" />
      <Skeleton className="h-3 w-3/5" />
      <span className="sr-only">Loading</span>
    </div>
  </div>
);

type LibraryRowProps = {
  song: PartySong | undefined;
  index: number;
  total: number;
  offset: string;
  onAdd: (song: PartySong) => void;
  adding: boolean;
};

const LibraryRow = ({ song, index, total, offset, onAdd, adding }: LibraryRowProps) => (
  <li
    aria-posinset={index + 1}
    aria-setsize={total}
    className={cn('absolute inset-x-0 h-16', index < total - 1 && 'border-b')}
    style={{ top: offset }}
  >
    {song === undefined ? <PendingRow /> : <SongRow adding={adding} onAdd={onAdd} song={song} />}
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

/**
 * The whole library as one scroll, however long it is. The host says how many
 * songs match, the list reserves that much room, and only the rows a thumb can
 * reach are in the document or fetched from the host.
 */
const SongResults = ({ search }: { search: string }) => {
  const { total, isLoading, error } = usePartyLibrarySize(search);
  const { mutate: add, isLoading: adding } = useAddToPartyQueue();

  const { scrollRef, start, end, listHeight, rowOffset } = useVirtualRows({
    count: total,
    rowHeightRem: ROW_HEIGHT_REM,
    overscan: OVERSCAN_ROWS,
  });

  const songAt = usePartyLibraryWindow(search, start, end);

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

  if (total === 0) {
    return <NoResults searching={search.length > 0} />;
  }

  return (
    // A new search is a different list, and the offset a reader left in the old
    // one points at an unrelated song in it, so the scroller starts again.
    <div
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-md border"
      key={search}
      ref={scrollRef}
    >
      <ul className="relative w-full" style={{ height: listHeight }}>
        {Array.from({ length: end - start }, (_, offset) => (
          <LibraryRow
            adding={adding}
            index={start + offset}
            key={start + offset}
            offset={rowOffset(start + offset)}
            onAdd={add}
            song={songAt(start + offset)}
            total={total}
          />
        ))}
      </ul>
    </div>
  );
};

/**
 * The library as a phone sees it: a search box, the whole list under it, and
 * one action. Adding is the only thing a guest may do to the library — nothing
 * here renames, deletes, or plays a song directly.
 */
export const LibrarySection = () => {
  const [search, setSearch] = useState('');

  return (
    <section aria-label="Library" className="flex h-full min-h-0 min-w-0 flex-col gap-3">
      <div className="relative shrink-0">
        <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search the library"
          className={cn(TOUCH_FIELD, 'pl-9')}
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
