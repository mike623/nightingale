import { useQuery } from '@tanstack/react-query';

import { importedVideoId } from '@/bridge/import';
import { isTauri } from '@/bridge/runtime';
import { IMPORTED_VIDEO_ID } from '@/shared/query-keys';

/**
 * The YouTube video id a song's file was imported from, or `null` for a file
 * that came from anywhere else. Re-downloading is offered only for a song this
 * answers for, since the id is the only handle the download has.
 *
 * Desktop only: Import is a Tauri-side feature (docs/adr/0001), so the web
 * build has no command to ask and every song reads as "not imported".
 */
export const useImportedVideoId = (fileHash: string) =>
  useQuery({
    queryKey: [...IMPORTED_VIDEO_ID, fileHash],
    queryFn: () => importedVideoId(fileHash),
    enabled: isTauri,
  });
