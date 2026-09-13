import { EntryProgress } from '@/features/import/components/entry-progress';
import { NoMatchEmpty } from '@/features/import/components/no-match-empty';
import { Input } from '@/shared/components/ui/input';
import type { ImportEntry } from '@/types/ImportEntry';
import type { ImportEntryProgress } from '@/types/ImportEntryProgress';
import type { ImportProgress } from '@/types/ImportProgress';

type ImportRunningListProps = {
  filter: string;
  rows: readonly ImportEntry[];
  aggregate: ImportProgress | null;
  progressById: Readonly<Record<string, ImportEntryProgress>>;
  imported: ReadonlySet<string>;
  onFilterChange: (value: string) => void;
};

/** The view a run in flight (or just finished) takes over: progress, not picking. */
export const ImportRunningList = ({
  filter,
  rows,
  aggregate,
  progressById,
  imported,
  onFilterChange,
}: ImportRunningListProps) => (
  <div className="flex min-h-0 flex-1 flex-col gap-2">
    <div className="flex items-center gap-3" data-nav-group="filter">
      <Input
        defaultValue={filter}
        placeholder="Search tracks"
        aria-label="Search tracks"
        className="min-w-0 flex-1"
        onChange={(e) => onFilterChange(e.target.value)}
      />
      {aggregate && (
        <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
          {aggregate.done}/{aggregate.total}
        </span>
      )}
    </div>
    {rows.length === 0 ? (
      <NoMatchEmpty />
    ) : (
      <ul className="min-h-0 flex-1 overflow-y-auto rounded-md border p-1 text-sm">
        {rows.map((e) => (
          <li key={e.id}>
            <div className="flex items-center gap-2 rounded px-1 py-1">
              <span className="truncate">
                {e.artist ? `${e.artist} — ` : ''}
                {e.title}
              </span>
              <EntryProgress progress={progressById[e.id]} alreadyImported={imported.has(e.id)} />
            </div>
          </li>
        ))}
      </ul>
    )}
  </div>
);
