import { useCallback } from 'react';

import { useClearCache } from '@/features/library/hooks/use-clear-cache';
import {
  useDialog,
  type ClearCacheTarget,
  type DialogMode,
} from '@/features/menu/hooks/use-dialog';
import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/components/ui/alert-dialog';
import { cn } from '@/shared/utils/cn';

const RING = 'ring-2 ring-primary';
const NO_FOCUS_RING = 'focus-visible:ring-0 focus-visible:border-transparent';

const clearCacheTarget = (mode: DialogMode): ClearCacheTarget | null => {
  if (typeof mode !== 'object' || mode === null || mode.mode !== 'clear-cache') {
    return null;
  }

  return mode.target;
};

const focusClass = (open: boolean, focusedIndex: number, index: number): string =>
  cn(NO_FOCUS_RING, open && focusedIndex === index && RING);

const COPY: Record<ClearCacheTarget, { title: string; description: string; confirm: string }> = {
  all: {
    title: 'Clear all cache?',
    description:
      'This will permanently delete every cached file: the stems, lyrics and timing generated for your songs, plus background videos and analysis models. Your original song files are not touched, but every song will have to be analyzed again.',
    confirm: 'Clear cache',
  },
  videos: {
    title: 'Clear videos cache?',
    description:
      "This will permanently delete all cached background videos. They will be re-downloaded the next time they're needed.",
    confirm: 'Clear cache',
  },
  models: {
    title: 'Clear models cache?',
    description:
      'This will permanently delete the cached analysis models. They will be re-downloaded the next time analysis runs.',
    confirm: 'Clear cache',
  },
  orphans: {
    title: 'Clean orphaned cache?',
    description:
      'This will permanently delete generated files left behind by songs that are no longer in your library. Songs still in the library keep everything they have.',
    confirm: 'Clean up',
  },
};

export const ClearCacheDialog = () => {
  const { close, mode } = useDialog();
  const clearCache = useClearCache();

  const target = clearCacheTarget(mode);
  const open = target !== null;

  const runClear = useCallback(() => {
    if (!target) {
      return;
    }
    void clearCache[target]();
    close();
  }, [target, clearCache, close]);

  const onConfirm = useCallback(
    (index: number) => {
      if (index === 0) {
        close();
      } else {
        runClear();
      }
    },
    [close, runClear],
  );

  const { focusedIndex } = useDialogNav({
    open,
    itemCount: 2,
    onConfirm,
    onBack: close,
  });

  const copy = target ? COPY[target] : null;

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy?.title ?? 'Clear cache?'}</AlertDialogTitle>
          <AlertDialogDescription>{copy?.description ?? ''}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={close} className={focusClass(open, focusedIndex, 0)}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={runClear}
            className={focusClass(open, focusedIndex, 1)}
          >
            {copy?.confirm ?? 'Clear cache'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
