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
import { useDialogNav } from "@/hooks/navigation/use-dialog-nav";
import { useAnalysis } from "@/hooks/use-analysis";
import { useDialog } from "@/hooks/use-dialog";
import { cn } from "@/lib/utils";
import { useCallback } from "react";
import { toast } from "sonner";

const RING = "ring-2 ring-primary";
const NO_FOCUS_RING = "focus-visible:ring-0 focus-visible:border-transparent";

export const DeleteSongDialog = () => {
  const { close, mode } = useDialog();
  const { deleteSong } = useAnalysis();

  const open = typeof mode === "object" && mode !== null && mode.mode === "delete-song";
  const song = open ? mode.song : null;
  const onDeleted = open ? mode.onDeleted : null;

  const runDelete = useCallback(async () => {
    if (!song) return;
    try {
      await deleteSong(song.file_hash);
      close();
      onDeleted?.();
      toast.info(`Deleted "${song.title}"`);
    } catch (error: unknown) {
      toast.error(
        `Could not delete the song: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }, [song, deleteSong, close, onDeleted]);

  const onConfirm = useCallback(
    (index: number) => {
      if (index === 0) close();
      else void runDelete();
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
          <AlertDialogTitle>Delete "{song?.title ?? "this song"}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the song file from your library folder, along with every
            generated file for it. It is not moved to the trash and cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={close}
            className={cn(NO_FOCUS_RING, open && focusedIndex === 0 && RING)}
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => void runDelete()}
            className={cn(NO_FOCUS_RING, open && focusedIndex === 1 && RING)}
          >
            Delete song
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
