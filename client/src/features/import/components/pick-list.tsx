import { NoMatchEmpty } from '@/features/import/components/no-match-empty';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { Input } from '@/shared/components/ui/input';
import type { ImportEntry } from '@/types/ImportEntry';
import type { ImportPreview } from '@/types/ImportPreview';

type ImportPickListProps = {
  preview: ImportPreview;
  rows: readonly ImportEntry[];
  filter: string;
  selected: ReadonlySet<string>;
  imported: ReadonlySet<string>;
  allSelected: boolean;
  selectedCount: number;
  onFilterChange: (value: string) => void;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
};

export const ImportPickList = ({
  preview,
  rows,
  filter,
  selected,
  imported,
  allSelected,
  selectedCount,
  onFilterChange,
  onToggle,
  onSelectAll,
  onDeselectAll,
}: ImportPickListProps) => (
  <div className="flex min-h-0 flex-1 flex-col gap-2">
    <Input
      defaultValue={filter}
      placeholder="Search tracks"
      aria-label="Search tracks"
      className="min-w-0"
      data-nav-group="filter"
      onChange={(e) => onFilterChange(e.target.value)}
    />
    <div className="flex items-center gap-3 text-sm text-muted-foreground" data-nav-group="select">
      <button
        type="button"
        className="shrink-0 text-xs underline underline-offset-2 hover:text-foreground disabled:no-underline disabled:opacity-50"
        disabled={allSelected}
        onClick={onSelectAll}
      >
        Select all
      </button>
      <button
        type="button"
        className="shrink-0 text-xs underline underline-offset-2 hover:text-foreground disabled:no-underline disabled:opacity-50"
        disabled={selectedCount === 0}
        onClick={onDeselectAll}
      >
        Deselect all
      </button>
      <span className="truncate">
        {preview.isPlaylist
          ? `Playlist${
              preview.playlistTitle !== null && preview.playlistTitle !== ''
                ? ` “${preview.playlistTitle}”`
                : ''
            } — pick tracks to import.`
          : `${preview.entries.length} videos — pick tracks to import.`}
      </span>
    </div>
    {rows.length === 0 ? (
      <NoMatchEmpty />
    ) : (
      <ul className="min-h-0 flex-1 overflow-y-auto rounded-md border p-1 text-sm">
        {rows.map((e) => (
          <li key={e.id} data-nav-group={`row:${e.id}`}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-accent">
              <Checkbox checked={selected.has(e.id)} onCheckedChange={() => onToggle(e.id)} />
              <span className={`truncate ${imported.has(e.id) ? 'text-muted-foreground' : ''}`}>
                {e.artist ? `${e.artist} — ` : ''}
                {e.title}
              </span>
              {imported.has(e.id) && (
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">Imported</span>
              )}
            </label>
          </li>
        ))}
      </ul>
    )}
  </div>
);
