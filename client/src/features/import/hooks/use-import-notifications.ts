import { useQueryClient } from '@tanstack/react-query';
import { useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';

import { IMPORT_TOAST_ID, onImportDone, onImportError, onImportProgress } from '@/bridge/import';
import { importProgressByIdAtom } from '@/features/import/hooks/use-import-state';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';
import { IMPORT_QUEUE, MENU, SONGS, SONGS_META } from '@/shared/query-keys';

export const IMPORT_PATH = '/import';

/**
 * App-level listener for background YouTube imports, and the only writer of the
 * import progress atom. Mount once, high in the tree (`MenuLayout`), so it
 * survives the Import page unmounting when the user navigates away mid-import.
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

  // Read inside the listeners without re-subscribing on every navigation.
  const onImportPageRef = useLatestRef(pathname === IMPORT_PATH);
  const navigateRef = useLatestRef(navigate);

  // Leaving the page mid-import must not leave a stale toast behind, and
  // arriving on it must not leave one floating over the real thing.
  useEffect(() => {
    if (pathname === IMPORT_PATH) {
      toast.dismiss(IMPORT_TOAST_ID);
    }
  }, [pathname]);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];

    void (async () => {
      unlisteners.push(
        await onImportProgress((p) => {
          if (p.entry) {
            const next = p.entry;
            setProgressById((prev) => ({ ...prev, [next.id]: next }));

            // A percentage is carried by the atom alone; a status change is
            // what the stored row records, so that is what needs re-reading.
            if (next.status !== 'Downloading') {
              void queryClient.invalidateQueries({ queryKey: IMPORT_QUEUE });
            }
          }

          // The page shows every track; a toast on top of it is just noise.
          if (onImportPageRef.current) {
            return;
          }

          toast.loading(`Importing ${p.done}/${p.total}…`, {
            id: IMPORT_TOAST_ID,
            action: {
              label: 'View',
              onClick: () => void navigateRef.current(IMPORT_PATH),
            },
          });
        }),
      );

      unlisteners.push(
        await onImportDone((r) => {
          void queryClient.invalidateQueries({ queryKey: IMPORT_QUEUE });
          void queryClient.invalidateQueries({ queryKey: SONGS });
          void queryClient.invalidateQueries({ queryKey: SONGS_META });
          void queryClient.invalidateQueries({ queryKey: MENU });

          if (onImportPageRef.current) {
            return;
          }

          const parts = [`Imported ${r.imported}`];
          if (r.skipped > 0) {
            parts.push(`${r.skipped} already`);
          }
          if (r.failed.length > 0) {
            parts.push(`${r.failed.length} failed`);
          }
          const msg =
            parts.join(' · ') +
            (r.playlistName !== null && r.playlistName !== '' ? ` → “${r.playlistName}”` : '');

          const options = {
            id: IMPORT_TOAST_ID,
            action: {
              label: 'View',
              onClick: () => void navigateRef.current(IMPORT_PATH),
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
          void queryClient.invalidateQueries({ queryKey: IMPORT_QUEUE });

          if (onImportPageRef.current) {
            return;
          }

          toast.error(`Import failed: ${e}`, { id: IMPORT_TOAST_ID });
        }),
      );
    })();

    return () => unlisteners.forEach((u) => u());
  }, [queryClient, setProgressById, navigateRef, onImportPageRef]);
}
