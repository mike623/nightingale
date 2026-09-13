import type { ImportPreview } from '@/types/ImportPreview';
import type { ImportProgress } from '@/types/ImportProgress';
import type { ImportReport } from '@/types/ImportReport';

import { invoke, listen } from './runtime';

/** Shared sonner toast id for the single in-flight import notification. */
export const IMPORT_TOAST_ID = 'youtube-import';

/** True only when the active library is a Folder — Import is hidden otherwise. */
export const importAvailable = async (): Promise<boolean> =>
  await invoke<boolean>('import_available');

/** Resolve a YouTube URL to a preview (single video or playlist) without downloading. */
export const probeImport = async (url: string): Promise<ImportPreview> =>
  await invoke<ImportPreview>('probe_import', { url });

/** YouTube video ids already imported into the active folder (file still on disk). */
export const importedVideoIds = async (): Promise<string[]> =>
  await invoke<string[]>('imported_video_ids');

/** Kick off a background download of the previewed entries. Returns immediately;
 * progress/completion arrive via the events below. */
export const startImport = async (preview: ImportPreview): Promise<void> =>
  await invoke<void>('start_import', { preview });

export const onImportProgress = async (cb: (p: ImportProgress) => void): Promise<() => void> =>
  await listen<ImportProgress>('import-progress', ({ payload }) => cb(payload));

export const onImportDone = async (cb: (r: ImportReport) => void): Promise<() => void> =>
  await listen<ImportReport>('import-done', ({ payload }) => cb(payload));

export const onImportError = async (cb: (e: string) => void): Promise<() => void> =>
  await listen<string>('import-error', ({ payload }) => cb(payload));
