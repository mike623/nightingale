import type { ImportEntryProgress } from "@/types/ImportEntryProgress";
import type { ImportPreview } from "@/types/ImportPreview";
import type { ImportProgress } from "@/types/ImportProgress";
import type { ImportReport } from "@/types/ImportReport";
import { atom, useAtom, useAtomValue } from "jotai";

/**
 * Live state of the one in-flight (or last finished) import.
 *
 * It lives in atoms rather than on the Import page because an import keeps
 * running after the user navigates away: `useImportNotifications` is mounted in
 * `MenuLayout`, above the router `Outlet`, and is the only writer. The page
 * mounts and unmounts freely against this state without interrupting anything.
 *
 * No history is kept — starting an import replaces the previous one.
 */

/** Entries the current import is working through, in playlist order. */
export const importPreviewAtom = atom<ImportPreview | null>(null);

/** Per-entry state, keyed by YouTube video id. */
export const importProgressByIdAtom = atom<Record<string, ImportEntryProgress>>({});

/** Aggregate counters for the run (`done`/`total`, imported, skipped, failed). */
export const importAggregateAtom = atom<ImportProgress | null>(null);

/** Set once the run finishes; cleared when the next one starts. */
export const importReportAtom = atom<ImportReport | null>(null);

/** Set when the run failed outright (as opposed to individual entries failing). */
export const importErrorAtom = atom<string | null>(null);

/** True while entries are still being worked through. */
export const importRunningAtom = atom(
  (get) => get(importAggregateAtom) !== null && get(importReportAtom) === null,
);

/** Read-only view for the page and the toast. */
export const useImportState = () => ({
  preview: useAtomValue(importPreviewAtom),
  progressById: useAtomValue(importProgressByIdAtom),
  aggregate: useAtomValue(importAggregateAtom),
  report: useAtomValue(importReportAtom),
  error: useAtomValue(importErrorAtom),
  running: useAtomValue(importRunningAtom),
});

/**
 * Clear the finished run so the page falls back to the URL form. Only for a run
 * that has already ended — calling it mid-import would orphan the progress of
 * downloads that are still going.
 */
export const useClearImport = () => {
  const [, setPreview] = useAtom(importPreviewAtom);
  const [, setProgressById] = useAtom(importProgressByIdAtom);
  const [, setAggregate] = useAtom(importAggregateAtom);
  const [, setReport] = useAtom(importReportAtom);
  const [, setError] = useAtom(importErrorAtom);

  return () => {
    setPreview(null);
    setProgressById({});
    setAggregate(null);
    setReport(null);
    setError(null);
  };
};

/**
 * Seed the atoms for a run that is about to start. Called by the page right
 * before `startImport`, so the entries render as pending immediately instead of
 * waiting for the first progress tick.
 */
export const useBeginImport = () => {
  const [, setPreview] = useAtom(importPreviewAtom);
  const [, setProgressById] = useAtom(importProgressByIdAtom);
  const [, setAggregate] = useAtom(importAggregateAtom);
  const [, setReport] = useAtom(importReportAtom);
  const [, setError] = useAtom(importErrorAtom);

  return (preview: ImportPreview) => {
    setPreview(preview);
    setProgressById({});
    setReport(null);
    setError(null);
    setAggregate({
      done: 0,
      total: preview.entries.length,
      current: null,
      currentPct: 0,
      imported: 0,
      skipped: 0,
      failed: 0,
      entry: null,
    });
  };
};
