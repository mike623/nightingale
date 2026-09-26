import { useCallback } from 'react';
import { toast } from 'sonner';

import { useAnalysis } from '@/features/library/hooks/use-analysis';
import { useDialog, type DialogMode } from '@/features/menu/hooks/use-dialog';
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
import type { Song } from '@/types/Song';

const RING = 'ring-2 ring-primary';
const NO_FOCUS_RING = 'focus-visible:ring-0 focus-visible:border-transparent';

type DeleteSongRequest = { song: Song; onDeleted: () => void };

const deleteSongRequest = (mode: DialogMode): DeleteSongRequest | null => {
  if (typeof mode !== 'object' || mode === null || mode.mode !== 'delete-song') {
    return null;
  }

  return { song: mode.song, onDeleted: mode.onDeleted };
};

const focusClass = (open: boolean, focusedIndex: number, index: number): string =>
  cn(NO_FOCUS_RING, open && focusedIndex === index && RING);

export const DeleteSongDialog = () => {
  const { close, mode } = useDialog();
  const { deleteSong } = useAnalysis();

  const request = deleteSongRequest(mode);
  const open = request !== null;

  const runDelete = useCallback(async () => {
    if (!request) {
      return;
    }

    try {
      await deleteSong(request.song.file_hash);
      close();
      request.onDeleted();
      toast.info(`Deleted "${request.song.title}"`);
    } catch (error: unknown) {
      toast.error(
        `Could not delete the song: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }, [request, deleteSong, close]);

  const onConfirm = useCallback(
    (index: number) => {
      if (index === 0) {
        close();
      } else {
        void runDelete();
      }
    },
    [close, runDelete],
  );

  const { focusedIndex } = useDialogNav({
    open,
    itemCount: 2,
    onConfirm,
    onBack: close,
  });

  return (
    <AlertDialog open={open} onOpenChange={close}>
      <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete &quot;{request?.song.title ?? 'this song'}&quot;?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the song file from your library folder, along with every
            generated file for it. It is not moved to the trash and cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={close} className={focusClass(open, focusedIndex, 0)}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => void runDelete()}
            className={focusClass(open, focusedIndex, 1)}
          >
            Delete song
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
