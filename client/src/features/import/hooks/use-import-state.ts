import { useQuery } from '@tanstack/react-query';
import { atom, useAtomValue } from 'jotai';

import { importQueue } from '@/bridge/import';
import { IMPORT_QUEUE } from '@/shared/query-keys';
import type { ImportEntryProgress } from '@/types/ImportEntryProgress';

/**
 * Live state of the import queue, in two halves.
 *
 * The rows themselves are the host's: the queue is a table in the library
 * database, written by the worker and read back here, so it survives the page
 * unmounting, the app closing, and rows arriving from a phone rather than from
 * this screen.
 *
 * The download percentage is not. It changes every whole percent, which is far
 * too often to be worth a row write and a refetch, so it rides the progress
 * event into the atom below and the table overlays it on the row.
 */

/** Per-entry download progress, keyed by YouTube video id. */
export const importProgressByIdAtom = atom<Record<string, ImportEntryProgress>>({});

export const useImportQueue = () =>
  useQuery({
    queryKey: IMPORT_QUEUE,
    queryFn: importQueue,
  });

export const useImportProgress = () => useAtomValue(importProgressByIdAtom);
