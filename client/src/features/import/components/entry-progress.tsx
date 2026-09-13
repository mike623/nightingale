import { Badge } from '@/shared/components/ui/badge';
import { Progress } from '@/shared/components/ui/progress';
import type { ImportEntryProgress } from '@/types/ImportEntryProgress';

/** Per-row status pill + bar. `progress` is undefined until the entry is reached. */
export function EntryProgress({
  progress,
  alreadyImported,
}: {
  progress: ImportEntryProgress | undefined;
  alreadyImported: boolean;
}) {
  if (!progress) {
    return alreadyImported ? (
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">Imported</span>
    ) : null;
  }

  if (progress.status === 'Downloading') {
    return (
      <span className="ml-auto flex w-32 shrink-0 items-center gap-2">
        <Progress value={progress.pct * 100} max={100} className="flex-1" />
        <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {Math.round(progress.pct * 100)}%
        </span>
      </span>
    );
  }

  const variant = progress.status === 'Failed' ? 'destructive' : 'secondary';

  return (
    <Badge variant={variant} className="ml-auto shrink-0" title={progress.reason ?? undefined}>
      {progress.status}
    </Badge>
  );
}
