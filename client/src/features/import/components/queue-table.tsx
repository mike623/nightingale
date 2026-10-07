import { NoMatchEmpty } from '@/features/import/components/no-match-empty';
import { StatusCell } from '@/features/import/components/status-cell';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { Input } from '@/shared/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table';
import { formatSeconds } from '@/shared/utils/format-duration';
import type { ImportEntryProgress } from '@/types/ImportEntryProgress';
import type { ImportQueueRow } from '@/types/ImportQueueRow';

type ImportQueueTableProps = {
  rows: readonly ImportQueueRow[];
  progressById: Readonly<Record<string, ImportEntryProgress>>;
  selected: ReadonlySet<string>;
  /** Video ids already in the folder from an earlier import. */
  imported: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onEdit: (id: string, patch: Partial<{ title: string; artist: string }>) => void;
};

/** A draft is still the user's to change; everything else is a record of work. */
const isDraft = (row: ImportQueueRow) => row.status === 'Draft';

type RowProps = {
  row: ImportQueueRow;
  progress: ImportEntryProgress | undefined;
  checked: boolean;
  alreadyHave: boolean;
  onToggle: (id: string) => void;
  onEdit: (id: string, patch: Partial<{ title: string; artist: string }>) => void;
};

const QueueRow = ({ row, progress, checked, alreadyHave, onToggle, onEdit }: RowProps) => {
  const draft = isDraft(row);

  return (
    <TableRow data-nav-group={`row:${row.id}`}>
      <TableCell className="w-8">
        {draft && (
          <Checkbox
            aria-label={`Import ${row.title}`}
            checked={checked}
            onCheckedChange={() => onToggle(row.id)}
          />
        )}
      </TableCell>

      <TableCell className="max-w-0">
        {draft ? (
          <Input
            aria-label={`Title of ${row.title}`}
            className="h-8"
            onChange={(e) => onEdit(row.id, { title: e.target.value })}
            value={row.title}
          />
        ) : (
          <span className="block truncate">{row.title}</span>
        )}
      </TableCell>

      <TableCell className="hidden max-w-0 sm:table-cell">
        {draft ? (
          <Input
            aria-label={`Artist of ${row.title}`}
            className="h-8"
            onChange={(e) => onEdit(row.id, { artist: e.target.value })}
            value={row.artist}
          />
        ) : (
          <span className="block truncate text-muted-foreground">{row.artist}</span>
        )}
      </TableCell>

      <TableCell className="w-16 text-right tabular-nums text-muted-foreground">
        {row.durationSecs > 0 ? formatSeconds(row.durationSecs) : '—'}
      </TableCell>

      <TableCell className="w-40">
        <StatusCell alreadyHave={alreadyHave} progress={progress} row={row} />
      </TableCell>
    </TableRow>
  );
};

/**
 * One table for the whole import surface: what is about to be queued, what is
 * queued, what is downloading, and what a finished run did. A row's status is
 * the only thing that separates those, so they do not need separate screens.
 */
export const ImportQueueTable = ({
  rows,
  progressById,
  selected,
  imported,
  onToggle,
  onEdit,
}: ImportQueueTableProps) => {
  if (rows.length === 0) {
    return <NoMatchEmpty />;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
      <Table>
        <TableHeader className="sticky top-0 z-10 bg-background">
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>Title</TableHead>
            <TableHead className="hidden sm:table-cell">Artist</TableHead>
            <TableHead className="w-16 text-right">Time</TableHead>
            <TableHead className="w-40">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <QueueRow
              alreadyHave={imported.has(row.id)}
              checked={selected.has(row.id)}
              key={row.id}
              onEdit={onEdit}
              onToggle={onToggle}
              progress={progressById[row.id]}
              row={row}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
