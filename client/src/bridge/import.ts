import type { ImportPreview } from "@/types/ImportPreview";
import type { ImportReport } from "@/types/ImportReport";

import { invoke } from "./runtime";

/** True only when the active library is a Folder — Import is hidden otherwise. */
export const importAvailable = async (): Promise<boolean> =>
  await invoke<boolean>("import_available");

/** Resolve a YouTube URL to a preview (single video or playlist) without downloading. */
export const probeImport = async (url: string): Promise<ImportPreview> =>
  await invoke<ImportPreview>("probe_import", { url });

/** Download the previewed entries into the watched folder and trigger a rescan. */
export const runImport = async (preview: ImportPreview): Promise<ImportReport> =>
  await invoke<ImportReport>("run_import", { preview });
