import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useDialogNav } from "@/hooks/navigation/use-dialog-nav";
import { useCallback } from "react";
import { cn } from "@/lib/utils";

const RING = "ring-2 ring-primary";
const NO_FOCUS_RING = "focus-visible:ring-0 focus-visible:border-transparent";

interface PauseOverlayProps {
  open: boolean;
  onExit: () => void;
  onContinue: () => void;
  onNext: () => void;
}

export const PauseOverlay = ({ open, onExit, onContinue, onNext }: PauseOverlayProps) => {
  const onConfirm = useCallback(
    (index: number) => {
      if (index === 0) {
        onContinue();
      } else if (index === 1) {
        onNext();
      } else {
        onExit();
      }
    },
    [onContinue, onExit, onNext],
  );

  const { focusedIndex } = useDialogNav({
    open,
    itemCount: 3,
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
          <AlertDialogAction
            variant="destructive"
            onClick={onExit}
            className={cn(NO_FOCUS_RING, open && focusedIndex === 2 && RING)}
          >
            Exit to Menu
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
