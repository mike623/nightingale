import { ImportPickList } from '@/features/import/components/pick-list';
import { ImportRunningList } from '@/features/import/components/running-list';
import { ImportSingleFields } from '@/features/import/components/single-fields';
import { ImportUnavailable } from '@/features/import/components/unavailable';
import { ImportUrlForm } from '@/features/import/components/url-form';
import type { LastPlaylist } from '@/features/import/lib/last-playlist';
import type { ImportEntry } from '@/types/ImportEntry';
import type { ImportEntryProgress } from '@/types/ImportEntryProgress';
import type { ImportPreview } from '@/types/ImportPreview';
import type { ImportProgress } from '@/types/ImportProgress';

type ImportBodyProps = {
  checkingAvailable: boolean;
  available: boolean | undefined;
  shown: ImportPreview | null;
  preview: ImportPreview | null;
  single: ImportEntry | null;
  rows: readonly ImportEntry[];
  filter: string;
  url: string;
  busy: boolean;
  lastPlaylist: LastPlaylist | null;
  aggregate: ImportProgress | null;
  progressById: Readonly<Record<string, ImportEntryProgress>>;
  imported: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  allSelected: boolean;
  selectedCount: number;
  onFilterChange: (value: string) => void;
  onUrlChange: (value: string) => void;
  onFetch: (url?: string) => void;
  onEditSingle: (patch: Partial<{ title: string; artist: string }>) => void;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
};

/** Picks the one view the page is in: unavailable, running, URL form, or picking. */
export const ImportBody = ({
  checkingAvailable,
  available,
  shown,
  preview,
  single,
  rows,
  filter,
  url,
  busy,
  lastPlaylist,
  aggregate,
  progressById,
  imported,
  selected,
  allSelected,
  selectedCount,
  onFilterChange,
  onUrlChange,
  onFetch,
  onEditSingle,
  onToggle,
  onSelectAll,
  onDeselectAll,
}: ImportBodyProps) => {
  if (checkingAvailable) {
    return null;
  }

  if (available !== true) {
    return <ImportUnavailable />;
  }

  // A run in flight (or just finished) takes over the view.
  if (shown !== null && preview === null) {
    return (
      <ImportRunningList
        filter={filter}
        rows={rows}
        aggregate={aggregate}
        progressById={progressById}
        imported={imported}
        onFilterChange={onFilterChange}
      />
    );
  }

  if (preview === null) {
    return (
      <ImportUrlForm
        url={url}
        busy={busy}
        lastPlaylist={lastPlaylist}
        onUrlChange={onUrlChange}
        onFetch={onFetch}
      />
    );
  }

  if (single !== null) {
    return <ImportSingleFields entry={single} onEdit={onEditSingle} />;
  }

  return (
    <ImportPickList
      preview={preview}
      rows={rows}
      filter={filter}
      selected={selected}
      imported={imported}
      allSelected={allSelected}
      selectedCount={selectedCount}
      onFilterChange={onFilterChange}
      onToggle={onToggle}
      onSelectAll={onSelectAll}
      onDeselectAll={onDeselectAll}
    />
  );
};
