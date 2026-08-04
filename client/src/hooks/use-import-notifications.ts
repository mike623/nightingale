import { IMPORT_TOAST_ID, onImportDone, onImportError, onImportProgress } from "@/bridge/import";
import { MENU, SONGS, SONGS_META } from "@/queries/keys";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";

/**
 * App-level listener for background YouTube imports. Streams progress into a
 * single sonner toast and refreshes the library when the import finishes.
 * Mount once, high in the tree, so it survives the import dialog closing.
 */
export function useImportNotifications() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unlisteners: Array<() => void> = [];

    (async () => {
      unlisteners.push(
        await onImportProgress((p) => {
          const pct =
            p.currentPct > 0 && p.currentPct < 1 ? ` (${Math.round(p.currentPct * 100)}%)` : "";
          const label = p.current
            ? `Importing ${Math.min(p.done + 1, p.total)}/${p.total}: ${p.current}${pct}`
            : `Importing ${p.done}/${p.total}…`;
          toast.loading(label, { id: IMPORT_TOAST_ID });
        }),
      );

      unlisteners.push(
        await onImportDone((r) => {
          const parts = [`Imported ${r.imported}`];
          if (r.skipped > 0) parts.push(`${r.skipped} already`);
          if (r.failed.length > 0) parts.push(`${r.failed.length} failed`);
          const msg = parts.join(" · ") + (r.playlistName ? ` → “${r.playlistName}”` : "");
          if (r.failed.length > 0) {
            toast.warning(msg, { id: IMPORT_TOAST_ID });
          } else {
            toast.success(msg, { id: IMPORT_TOAST_ID });
          }
          queryClient.invalidateQueries({ queryKey: SONGS });
          queryClient.invalidateQueries({ queryKey: SONGS_META });
          queryClient.invalidateQueries({ queryKey: MENU });
        }),
      );

      unlisteners.push(
        await onImportError((e) => {
          toast.error(`Import failed: ${e}`, { id: IMPORT_TOAST_ID });
        }),
      );
    })();

    return () => unlisteners.forEach((u) => u());
  }, [queryClient]);
}
