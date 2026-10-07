import { DownloadIcon } from 'lucide-react';
import { useState } from 'react';

import type { PartyImport } from '@/bridge/party';
import { errorMessage } from '@/features/remote/lib/error-message';
import { TOUCH_FIELD, TOUCH_TARGET } from '@/features/remote/lib/touch-target';
import { usePartyImports, useSubmitPartyImport } from '@/features/remote/queries/use-party';
import { Button } from '@/shared/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/components/ui/empty';
import { Input } from '@/shared/components/ui/input';
import { Progress } from '@/shared/components/ui/progress';
import { Spinner } from '@/shared/components/ui/spinner';
import { cn } from '@/shared/utils/cn';

const STATUS_LABELS: Record<PartyImport['status'], string> = {
  draft: 'Waiting',
  queued: 'Waiting',
  downloading: 'Downloading',
  imported: 'Added to the library',
  skipped: 'Already in the library',
  failed: 'Could not be downloaded',
};

/** As much as a guest is told. The host keeps the download tool's own words. */
const PROBLEM_LABELS: Record<NonNullable<PartyImport['problem']>, string> = {
  unavailable: 'This video cannot be downloaded',
  network: 'The network dropped — try again',
  failed: 'Could not be downloaded',
};

const statusLine = (item: PartyImport) =>
  item.status === 'failed' && item.problem !== null
    ? PROBLEM_LABELS[item.problem]
    : STATUS_LABELS[item.status];

const ImportRow = ({ item }: { item: PartyImport }) => (
  <li className="min-w-0 border-b py-2 last:border-b-0">
    <p className="truncate text-sm font-medium">{item.title}</p>

    {item.status === 'downloading' ? (
      <span className="mt-1 flex items-center gap-2">
        <Progress className="flex-1" max={100} value={Math.round(item.pct * 100)} />
        <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {Math.round(item.pct * 100)}%
        </span>
      </span>
    ) : (
      <p className="truncate text-xs text-muted-foreground">{statusLine(item)}</p>
    )}
  </li>
);

const ImportList = () => {
  const { data, isLoading, error } = usePartyImports();

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
        The imports could not be read: {errorMessage(error)}
      </p>
    );
  }

  const items = data ?? [];

  if (items.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Nothing downloading</EmptyTitle>
          <EmptyDescription>
            Paste a YouTube link above and it will be added to the library.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ul aria-live="polite" className="rounded-md border px-3">
      {items.map((item) => (
        <ImportRow item={item} key={item.id} />
      ))}
    </ul>
  );
};

/**
 * Submitting a link, and watching what the host does with it. A guest has no
 * screen to come back to, so the wait has to be visible here or the tap looks
 * like it did nothing.
 */
export const ImportSection = () => {
  const [url, setUrl] = useState('');
  const { mutate: submit, isLoading } = useSubmitPartyImport();

  const send = () => {
    const link = url.trim();
    if (link === '' || isLoading) {
      return;
    }
    submit(link, { onSuccess: () => setUrl('') });
  };

  return (
    <section aria-label="Import" className="min-w-0 space-y-3">
      <form
        className="flex min-w-0 items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <Input
          aria-label="YouTube link"
          className={cn(TOUCH_FIELD, 'min-w-0 flex-1')}
          enterKeyHint="go"
          inputMode="url"
          onChange={(event) => setUrl(event.target.value)}
          placeholder="Paste a YouTube link"
          type="url"
          value={url}
        />
        <Button
          className={cn(TOUCH_TARGET, 'shrink-0 px-3')}
          disabled={isLoading || url.trim() === ''}
          type="submit"
          variant="outline"
        >
          <DownloadIcon />
          <span className="sr-only sm:not-sr-only">Add</span>
        </Button>
      </form>

      <p className="text-xs text-muted-foreground">
        One video at a time. It is downloaded and analysed on the host, then appears in the library.
      </p>

      <ImportList />
    </section>
  );
};
