import { importAvailable } from "@/bridge/import";
import { useQuery } from "@tanstack/react-query";
import { IMPORT_AVAILABLE } from "./keys";

/**
 * Whether Import is usable — true only for a Folder library, since imported
 * files are written into the watched folder (docs/adr/0001).
 *
 * The sidebar hides the Import entry for remote sources, but `/import` is
 * reachable by URL, so the page checks for itself rather than trusting that.
 * Keyed off the config query's lifetime: switching source invalidates it.
 */
export const useImportAvailable = () =>
  useQuery({
    queryKey: IMPORT_AVAILABLE,
    queryFn: importAvailable,
    staleTime: 0,
  });
