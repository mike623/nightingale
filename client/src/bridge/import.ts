import type { ImportPreview } from '@/types/ImportPreview';
import type { ImportProgress } from '@/types/ImportProgress';
import type { ImportQueueRow } from '@/types/ImportQueueRow';
import type { ImportReport } from '@/types/ImportReport';
import type { Song } from '@/types/Song';

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

/** The YouTube video id a song's file was imported from, or `null` for a file
 * that came from anywhere else. */
export const importedVideoId = async (fileHash: string): Promise<string | null> =>
  await invoke<string | null>('imported_video_id', { fileHash });

/** Download a song's YouTube video again over the file on disk. Resolves with
 * the song under its new hash once the download lands. */
export const redownloadSong = async (fileHash: string): Promise<Song> =>
  await invoke<Song>('redownload_song', { fileHash });

/** Put the previewed entries in the import queue as one job, and answer with the
 * rows as queued. The worker picks the job up in turn; progress and completion
 * arrive via the events below. */
export const startImport = async (preview: ImportPreview): Promise<ImportQueueRow[]> =>
  await invoke<ImportQueueRow[]>('start_import', { preview });

/** The whole import queue, oldest job first, including rows from runs that have
 * already ended. */
export const importQueue = async (): Promise<ImportQueueRow[]> =>
  await invoke<ImportQueueRow[]>('import_queue');

/** Forget the queue rows of runs that have ended, leaving anything still queued
 * or downloading. Resolves with how many rows went. */
export const clearFinishedImports = async (): Promise<number> =>
  await invoke<number>('clear_finished_imports');

export const onImportProgress = async (cb: (p: ImportProgress) => void): Promise<() => void> =>
  await listen<ImportProgress>('import-progress', ({ payload }) => cb(payload));

export const onImportDone = async (cb: (r: ImportReport) => void): Promise<() => void> =>
  await listen<ImportReport>('import-done', ({ payload }) => cb(payload));

export const onImportError = async (cb: (e: string) => void): Promise<() => void> =>
  await listen<string>('import-error', ({ payload }) => cb(payload));
