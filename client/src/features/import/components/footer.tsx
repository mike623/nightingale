import { Loader2Icon } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

type ImportActionsProps = {
  busy: boolean;
  url: string;
  probed: { done: number; total: number } | null;
  draftCount: number;
  selectedCount: number;
  failedCount: number;
  finishedCount: number;
  onFetch: () => void;
  onEnqueue: () => void;
  onRetryFailed: () => void;
  onClearFinished: () => void;
};

type ImportFooterProps = ImportActionsProps & {
  available: boolean | undefined;
  onClose: () => void;
};

const Spinner = ({ busy }: { busy: boolean }) =>
  busy ? <Loader2Icon className="size-4 animate-spin" /> : null;

/**
 * Which actions apply is decided by what the queue holds rather than by a mode
 * the page is in: drafts can be queued, failed rows can be retried, finished
 * rows can be forgotten, and any of those can be true at the same time.
 */
const ImportActions = ({
  busy,
  url,
  probed,
  draftCount,
  selectedCount,
  failedCount,
  finishedCount,
  onFetch,
  onEnqueue,
  onRetryFailed,
  onClearFinished,
}: ImportActionsProps) => (
  <>
    {finishedCount > 0 && (
      <Button onClick={onClearFinished} variant="ghost">
        Clear {finishedCount} finished
      </Button>
    )}

    {failedCount > 0 && (
      <Button disabled={busy} onClick={onRetryFailed} variant="secondary">
        <Spinner busy={busy} />
        Retry {failedCount} failed
      </Button>
    )}

    {draftCount > 0 ? (
      <Button disabled={busy || selectedCount === 0} onClick={onEnqueue}>
        <Spinner busy={busy} />
        Add {selectedCount} to the queue
      </Button>
    ) : (
      <Button disabled={busy || url.trim() === ''} onClick={onFetch}>
        <Spinner busy={busy} />
        {probed ? `Fetching ${probed.done}/${probed.total}…` : 'Fetch'}
      </Button>
    )}
  </>
);

export const ImportFooter = ({ available, onClose, ...actions }: ImportFooterProps) => (
  <div
    className="flex shrink-0 flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end"
    data-nav-group="footer"
  >
    {available === true && <ImportActions {...actions} />}

    <Button onClick={onClose} variant="outline">
      Close
    </Button>
  </div>
);
