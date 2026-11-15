import { DownloadIcon } from 'lucide-react';
import { useState } from 'react';

import type { RemoteImport } from '@/bridge/remote-control';
import { TOUCH_FIELD, TOUCH_TARGET } from '@/features/remote/lib/touch-target';
import {
  useRemoteImports,
  useSubmitRemoteImport,
} from '@/features/remote/queries/use-remote-imports';
import { t, type TranslationKey } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/components/ui/empty';
import { Input } from '@/shared/components/ui/input';
import { Progress } from '@/shared/components/ui/progress';
import { cn } from '@/shared/utils/cn';

const STATUS_LABELS: Record<RemoteImport['status'], TranslationKey> = {
  Draft: 'remote.import.status.waiting',
  Queued: 'remote.import.status.waiting',
  Downloading: 'remote.import.status.downloading',
  Imported: 'remote.import.status.imported',
  Skipped: 'remote.import.status.skipped',
  Failed: 'remote.import.status.failed',
};

/** As much as a guest is told; the host keeps the download tool's own words. */
const PROBLEM_LABELS: Record<NonNullable<RemoteImport['problem']>, TranslationKey> = {
  unavailable: 'remote.import.problem.unavailable',
  network: 'remote.import.problem.network',
  failed: 'remote.import.status.failed',
};

const statusLine = (item: RemoteImport): string =>
  t(
    item.status === 'Failed' && item.problem !== null
      ? PROBLEM_LABELS[item.problem]
      : STATUS_LABELS[item.status],
  );

const ImportRow = ({ item }: { item: RemoteImport }) => (
  <li className="min-w-0 border-b py-2 last:border-b-0">
    <p className="truncate text-sm font-medium">{item.title}</p>
    {item.status === 'Downloading' ? (
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

const ImportList = ({ items }: { items: readonly RemoteImport[] }) => {
  if (items.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('remote.import.empty')}</EmptyTitle>
          <EmptyDescription>{t('remote.import.emptyDescription')}</EmptyDescription>
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
 * Submit a YouTube link and watch the host work through it. A guest has no
 * other screen to come back to, so the wait is visible here.
 */
export const ImportSection = () => {
  const [url, setUrl] = useState('');
  const { data: items = [] } = useRemoteImports();
  const { mutate: submit, isLoading } = useSubmitRemoteImport();

  const send = () => {
    const link = url.trim();
    if (link === '' || isLoading) {
      return;
    }
    submit(link, { onSuccess: () => setUrl('') });
  };

  return (
    <section aria-label={t('remote.tabs.import')} className="min-w-0 space-y-3">
      <form
        className="flex min-w-0 items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <Input
          aria-label={t('remote.import.linkLabel')}
          className={cn(TOUCH_FIELD, 'min-w-0 flex-1')}
          enterKeyHint="go"
          inputMode="url"
          onChange={(event) => setUrl(event.target.value)}
          placeholder={t('remote.import.linkLabel')}
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
          <span className="sr-only sm:not-sr-only">{t('remote.library.add')}</span>
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">{t('remote.import.hint')}</p>
      <ImportList items={items} />
    </section>
  );
};
