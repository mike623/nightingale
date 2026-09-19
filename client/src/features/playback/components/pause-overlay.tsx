import { useCallback } from 'react';

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
import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/utils/cn';

const RING = 'ring-2 ring-primary';
const NO_FOCUS_RING = 'focus-visible:ring-0 focus-visible:border-transparent';

type PauseOverlayProps = {
  open: boolean;
  exitLabel: string;
  onExit: () => void;
  onContinue: () => void;
  onNext: () => void;
  onEditLyrics: () => void;
};

export const PauseOverlay = ({
  open,
  exitLabel,
  onExit,
  onContinue,
  onNext,
  onEditLyrics,
}: PauseOverlayProps) => {
  const onConfirm = useCallback(
    (index: number) => {
      if (index === 0) {
        onContinue();
      } else if (index === 1) {
        onNext();
      } else if (index === 2) {
        onEditLyrics();
      } else {
        onExit();
      }
    },
    [onContinue, onEditLyrics, onExit, onNext],
  );

  const { focusedIndex } = useDialogNav({
    open,
    itemCount: 4,
    onConfirm,
    onBack: onContinue,
  });

  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onContinue()}>
      <AlertDialogContent onEscapeKeyDown={(e) => e.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Paused</AlertDialogTitle>
          <AlertDialogDescription>Exiting now won&apos;t save your progress</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={onContinue}
            className={cn(NO_FOCUS_RING, open && focusedIndex === 0 && RING)}
          >
            Continue
          </AlertDialogCancel>
          <Button
            variant="secondary"
            onClick={onNext}
            className={cn(NO_FOCUS_RING, open && focusedIndex === 1 && RING)}
          >
            Next Song
          </Button>
          <Button
            variant="secondary"
            onClick={onEditLyrics}
            className={cn(NO_FOCUS_RING, open && focusedIndex === 2 && RING)}
          >
            Edit Lyrics
          </Button>
          <AlertDialogAction
            variant="destructive"
            onClick={onExit}
            className={cn(NO_FOCUS_RING, open && focusedIndex === 3 && RING)}
          >
            {exitLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
