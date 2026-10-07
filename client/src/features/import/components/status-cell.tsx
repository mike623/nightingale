import { Badge } from '@/shared/components/ui/badge';
import { Progress } from '@/shared/components/ui/progress';
import type { ImportEntryProgress } from '@/types/ImportEntryProgress';
import type { ImportEntryStatus } from '@/types/ImportEntryStatus';
import type { ImportQueueRow } from '@/types/ImportQueueRow';

type StatusCellProps = {
  row: ImportQueueRow;
  progress: ImportEntryProgress | undefined;
  /** This video is already in the folder from an earlier import. */
  alreadyHave: boolean;
};

/** Sentence case, so the column reads as prose rather than as an enum. */
const LABELS: Record<ImportEntryStatus, string> = {
  Draft: 'About to import',
  Queued: 'Queued',
  Downloading: 'Downloading',
  Imported: 'Imported',
  Skipped: 'Already have it',
  Failed: 'Failed',
};

const VARIANTS: Record<ImportEntryStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  Draft: 'outline',
  Queued: 'outline',
  Downloading: 'secondary',
  Imported: 'default',
  Skipped: 'secondary',
  Failed: 'destructive',
};

const DownloadBar = ({ pct }: { pct: number }) => (
  <span className="flex items-center gap-2">
    <Progress className="flex-1" max={100} value={pct} />
    <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
      {pct}%
    </span>
  </span>
);

/**
 * A row's status, as the column should read it. A draft already on disk stays a
 * draft — it can still be ticked for a deliberate re-download — but is labelled
 * with what ticking it would mean.
 */
function shownStatus(
  row: ImportQueueRow,
  progress: ImportEntryProgress | undefined,
  alreadyHave: boolean,
): ImportEntryStatus {
  const status = progress?.status ?? row.status;

  if (status === 'Draft' && alreadyHave) {
    return 'Skipped';
  }

  return status;
}

/**
 * Where one row has got to. The live percentage comes from the progress event
 * rather than the row, which carries only the status it last changed to.
 */
export const StatusCell = ({ row, progress, alreadyHave }: StatusCellProps) => {
  const status = shownStatus(row, progress, alreadyHave);

  if (status === 'Downloading') {
    return <DownloadBar pct={Math.round((progress?.pct ?? row.pct) * 100)} />;
  }

  const reason = progress?.reason ?? row.reason;

  return (
    <Badge title={reason ?? undefined} variant={VARIANTS[status]}>
      {LABELS[status]}
    </Badge>
  );
};
