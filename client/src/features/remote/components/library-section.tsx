import { ListPlusIcon, SearchIcon } from 'lucide-react';
import { useState } from 'react';

import { useAddPlaybackQueueEntry } from '@/features/playback-queue/use-playback-queue';
import { useVirtualRows } from '@/features/remote/hooks/use-virtual-rows';
import { errorMessage } from '@/features/remote/lib/error-message';
import { TOUCH_FIELD, TOUCH_TARGET } from '@/features/remote/lib/touch-target';
import {
  useRemoteLibrarySize,
  useRemoteLibraryWindow,
} from '@/features/remote/queries/use-remote-library';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/components/ui/empty';
import { Input } from '@/shared/components/ui/input';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { Spinner } from '@/shared/components/ui/spinner';
import { cn } from '@/shared/utils/cn';
import { formatSeconds } from '@/shared/utils/format-duration';
import type { Song } from '@/types/Song';

/** Matches the `h-16` rows carry, in `rem` so the list follows text size. */
const ROW_HEIGHT_REM = 4;
const OVERSCAN_ROWS = 8;
const ROW_LAYOUT = 'flex h-full min-w-0 items-center justify-between gap-3 px-3';

type SongRowProps = {
  song: Song;
  onAdd: (song: Song) => void;
  adding: boolean;
};

const SongRow = ({ song, onAdd, adding }: SongRowProps) => (
  <div className={ROW_LAYOUT}>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium">{song.title}</p>
      <p className="truncate text-xs text-muted-foreground">
        {song.artist} · {formatSeconds(song.duration_secs)}
      </p>
    </div>
    <Button
      aria-label={t('remote.queue.addLabel', { value1: song.title })}
      className={cn(TOUCH_TARGET, 'shrink-0 px-3')}
      disabled={adding}
      onClick={() => onAdd(song)}
      type="button"
      variant="outline"
    >
      <ListPlusIcon />
      <span className="sr-only sm:not-sr-only">{t('remote.library.add')}</span>
    </Button>
  </div>
);

/** A row the host has not sent yet; the list knows its length up front. */
const PendingRow = () => (
  <div className={ROW_LAYOUT}>
    <div className="min-w-0 flex-1 space-y-2">
      <Skeleton className="h-3.5 w-2/5" />
      <Skeleton className="h-3 w-3/5" />
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  </div>
);

type LibraryRowProps = {
  song: Song | undefined;
  index: number;
  total: number;
  offset: string;
  onAdd: (song: Song) => void;
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
      <EmptyTitle>{t('remote.queue.noResults')}</EmptyTitle>
      <EmptyDescription>
        {searching ? t('remote.library.tryAnotherSearch') : t('remote.library.emptyLibrary')}
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

/**
 * The whole analyzed library as one scroll. The host says how many songs
 * match, the list reserves that much room, and only reachable rows are fetched.
 */
const SongResults = ({ search }: { search: string }) => {
  const { total, isLoading, error } = useRemoteLibrarySize(search);
  const { mutate: add, isLoading: adding } = useAddPlaybackQueueEntry();
  const { scrollRef, start, end, listHeight, rowOffset } = useVirtualRows({
    count: total,
    rowHeightRem: ROW_HEIGHT_REM,
    overscan: OVERSCAN_ROWS,
  });
  const songAt = useRemoteLibraryWindow(search, start, end);
  const addSong = (song: Song) =>
    add({ song, tempo: song.tempo, keyOffset: song.key_offset, position: 'bottom' });

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
        {t('remote.library.loadError', { error: errorMessage(error) })}
      </p>
    );
  }

  if (total === 0) {
    return <NoResults searching={search.length > 0} />;
  }

  return (
    // A new search is a different list, so the scroller starts again.
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
            onAdd={addSong}
            song={songAt(start + offset)}
            total={total}
          />
        ))}
      </ul>
    </div>
  );
};

/** Browse the host's analyzed library and add songs to the queue. */
export const LibrarySection = () => {
  const [search, setSearch] = useState('');

  return (
    <section
      aria-label={t('remote.tabs.library')}
      className="flex h-full min-h-0 min-w-0 flex-col gap-3"
    >
      <div className="relative shrink-0">
        <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label={t('remote.queue.searchPlaceholder')}
          className={cn(TOUCH_FIELD, 'pl-9')}
          enterKeyHint="search"
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('remote.queue.searchPlaceholder')}
          type="search"
          value={search}
        />
      </div>
      <SongResults search={search.trim()} />
    </section>
  );
};
