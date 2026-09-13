import { IMPORT_TOAST_ID, onImportDone, onImportError, onImportProgress } from "@/bridge/import";
import {
  importAggregateAtom,
  importErrorAtom,
  importProgressByIdAtom,
  importReportAtom,
} from "@/hooks/use-import-state";
import { MENU, SONGS, SONGS_META } from "@/queries/keys";
import { useQueryClient } from "@tanstack/react-query";
import { useSetAtom } from "jotai";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

export const IMPORT_PATH = "/import";

/**
 * App-level listener for background YouTube imports, and the only writer of the
 * import atoms. Mount once, high in the tree (`MenuLayout`), so it survives the
 * Import page unmounting when the user navigates away mid-import.
 *
 * The Import page is the real progress surface. This hook only keeps a
 * one-line toast for when the user is somewhere else, so they still learn an
 * import finished — clicking it goes back to the page.
 */
export function useImportNotifications() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const setProgressById = useSetAtom(importProgressByIdAtom);
  const setAggregate = useSetAtom(importAggregateAtom);
  const setReport = useSetAtom(importReportAtom);
  const setError = useSetAtom(importErrorAtom);

  // Read inside the listeners without re-subscribing on every navigation.
  const onImportPageRef = useRef(pathname === IMPORT_PATH);
  onImportPageRef.current = pathname === IMPORT_PATH;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // Leaving the page mid-import must not leave a stale toast behind, and
  // arriving on it must not leave one floating over the real thing.
  useEffect(() => {
    if (pathname === IMPORT_PATH) {
      toast.dismiss(IMPORT_TOAST_ID);
    }
  }, [pathname]);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];

    (async () => {
      unlisteners.push(
        await onImportProgress((p) => {
          setAggregate(p);

          if (p.entry) {
            const next = p.entry;
            setProgressById((prev) => ({ ...prev, [next.id]: next }));
          }

          // The page shows every track; a toast on top of it is just noise.
          if (onImportPageRef.current) {
            return;
          }

          toast.loading(`Importing ${p.done}/${p.total}…`, {
            id: IMPORT_TOAST_ID,
            action: {
              label: "View",
              onClick: () => navigateRef.current(IMPORT_PATH),
            },
          });
        }),
      );

      unlisteners.push(
        await onImportDone((r) => {
          setReport(r);

          queryClient.invalidateQueries({ queryKey: SONGS });
          queryClient.invalidateQueries({ queryKey: SONGS_META });
          queryClient.invalidateQueries({ queryKey: MENU });

          if (onImportPageRef.current) {
            return;
          }

          const parts = [`Imported ${r.imported}`];
          if (r.skipped > 0) parts.push(`${r.skipped} already`);
          if (r.failed.length > 0) parts.push(`${r.failed.length} failed`);
          const msg = parts.join(" · ") + (r.playlistName ? ` → “${r.playlistName}”` : "");

          const options = {
            id: IMPORT_TOAST_ID,
            action: {
              label: "View",
              onClick: () => navigateRef.current(IMPORT_PATH),
            },
          };

          if (r.failed.length > 0) {
            toast.warning(msg, options);
          } else {
            toast.success(msg, options);
          }
        }),
      );

      unlisteners.push(
        await onImportError((e) => {
          setError(e);

          if (onImportPageRef.current) {
            return;
          }

          toast.error(`Import failed: ${e}`, { id: IMPORT_TOAST_ID });
        }),
      );
    })();

    return () => unlisteners.forEach((u) => u());
  }, [queryClient, setAggregate, setProgressById, setReport, setError]);
}
