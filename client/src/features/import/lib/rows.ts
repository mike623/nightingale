import type { ImportPreview } from '@/types/ImportPreview';
import type { ImportQueueRow } from '@/types/ImportQueueRow';

/**
 * Draft rows live only on the import page, so they are given the shape the
 * queue's own rows have and the table renders one list. The columns a draft
 * cannot answer for are filled with what a draft means: it belongs to no job,
 * nothing has downloaded, and it came from this screen.
 */
const DRAFT_JOB_ID = 'draft';

export function draftRowsOf(preview: ImportPreview | null): ImportQueueRow[] {
  if (preview === null) {
    return [];
  }

  return preview.entries.map((entry, position) => ({
    id: entry.id,
    jobId: DRAFT_JOB_ID,
    title: entry.title,
    artist: entry.artist,
    durationSecs: entry.durationSecs,
    playlistId: preview.playlistId,
    playlistTitle: preview.playlistTitle,
    status: 'Draft',
    pct: 0,
    reason: null,
    submittedBy: 'Desktop',
    position,
    createdAt: 0,
  }));
}

export const failedRows = (rows: readonly ImportQueueRow[]): ImportQueueRow[] =>
  rows.filter((row) => row.status === 'Failed');

export const finishedRows = (rows: readonly ImportQueueRow[]): ImportQueueRow[] =>
  rows.filter(
    (row) => row.status === 'Imported' || row.status === 'Skipped' || row.status === 'Failed',
  );
