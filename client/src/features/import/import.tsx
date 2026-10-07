import { useQueryClient } from '@tanstack/react-query';
import { YoutubeIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import { clearFinishedImports, importedVideoIds, probeImport, startImport } from '@/bridge/import';
import { ImportFooter } from '@/features/import/components/footer';
import { ImportQueueTable } from '@/features/import/components/queue-table';
import { ImportUnavailable } from '@/features/import/components/unavailable';
import { ImportUrlForm } from '@/features/import/components/url-form';
import { useImportProgress, useImportQueue } from '@/features/import/hooks/use-import-state';
import { useNavStops } from '@/features/import/hooks/use-nav-stops';
import { useYoutubeWindow } from '@/features/import/hooks/use-youtube-window';
import { readLastPlaylist, saveLastPlaylist } from '@/features/import/lib/last-playlist';
import { draftRowsOf, failedRows, finishedRows } from '@/features/import/lib/rows';
import { useImportAvailable } from '@/features/import/queries/use-import-available';
import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import { IMPORT_QUEUE } from '@/shared/query-keys';
import type { ImportEntry } from '@/types/ImportEntry';
import type { ImportPreview } from '@/types/ImportPreview';

/**
 * How many links are probed at once. Each probe is its own yt-dlp process and
 * the time goes on the network round-trip, so overlapping a few is most of the
 * win; the cap is what keeps a long paste from spawning a process per line.
 */
const PROBE_CONCURRENCY = 5;

/** Matches the song-list search box, so filtering feels the same in both places. */
const FILTER_DEBOUNCE_MS = 500;

/** Links the user pasted, one per line, trimmed and de-duplicated. */
function parseUrls(text: string): string[] {
  return [
    ...new Set(
      text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}

export const ImportPage = () => {
  const navigate = useNavigate();
  const close = () => navigate('/');
  const queryClient = useQueryClient();

  const { data: available, isLoading: checkingAvailable } = useImportAvailable();
  const { data: queue } = useImportQueue();
  const progressById = useImportProgress();

  const [url, setUrl] = useState('');
  // Probed but not yet submitted: still the user's to edit and to pick from.
  // Drafts are deliberately local — leaving the page abandons them, where the
  // queue below is the host's and outlives both the page and the process.
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Video ids already on disk — shown as such and unchecked by default.
  const [imported, setImported] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // Probing several links takes a while (a yt-dlp process each), so it reports progress.
  const [probed, setProbed] = useState<{ done: number; total: number } | null>(null);
  const [filter, setFilter] = useState('');

  const filterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(filterTimer.current ?? undefined), []);

  const onFilterChange = (value: string) => {
    clearTimeout(filterTimer.current ?? undefined);
    filterTimer.current = setTimeout(() => setFilter(value), FILTER_DEBOUNCE_MS);
  };

  const drafts = useMemo(() => draftRowsOf(preview), [preview]);
  // A fresh array each render would retrigger every memo below it.
  const queueRows = useMemo(() => queue ?? [], [queue]);

  const rows = useMemo(() => {
    const all = [...drafts, ...queueRows];
    const needle = filter.trim().toLowerCase();
    if (!needle) {
      return all;
    }
    return all.filter((row) => `${row.artist} ${row.title}`.toLowerCase().includes(needle));
  }, [drafts, queueRows, filter]);

  const selectedCount = selected.size;
  const lastPlaylist = readLastPlaylist();
  const refreshQueue = () => queryClient.invalidateQueries({ queryKey: IMPORT_QUEUE });

  /**
   * Probes the pasted links, up to `PROBE_CONCURRENCY` at a time, and folds the
   * results into one preview. Several links always resolve to a flat list of
   * videos: only a lone playlist link keeps its playlist identity (and so its
   * `.m3u`), because there is no single playlist a merged list could belong to.
   *
   * Results and failures are kept against their input index, so finishing out
   * of order changes nothing the user sees.
   */
  const probeAll = async (urls: string[]): Promise<ImportPreview> => {
    const results = Array.from<ImportPreview | null>({ length: urls.length }).fill(null);
    const failures = Array.from<string | null>({ length: urls.length }).fill(null);

    let next = 0;
    let completed = 0;
    setProbed({ done: 0, total: urls.length });

    // Each worker takes the next index until the list runs out, then tail-calls
    // itself for the one after. `next++` needs no lock: nothing awaits between
    // reading and incrementing it. Recursion rather than a loop keeps the
    // bounded-concurrency shape without awaiting inside one.
    const worker = async (): Promise<void> => {
      const index = next++;
      if (index >= urls.length) {
        return;
      }

      try {
        results[index] = await probeImport(urls[index]);
      } catch (e) {
        failures[index] = `${urls[index]}: ${String(e)}`;
      }

      completed += 1;
      setProbed({ done: completed, total: urls.length });

      return worker();
    };

    await Promise.all(
      Array.from({ length: Math.min(PROBE_CONCURRENCY, urls.length) }, () => worker()),
    );

    const merged = new Map<string, ImportEntry>();
    results.forEach((p) => {
      // A later duplicate keeps the first entry: same video id, same file.
      p?.entries.forEach((entry) => {
        if (!merged.has(entry.id)) {
          merged.set(entry.id, entry);
        }
      });
    });

    const unread = failures.filter((f): f is string => f !== null);
    if (unread.length > 0) {
      toast.error(
        `Could not read ${unread.length} of ${urls.length} links`,
        // The list can be long; the first failing link is the useful one.
        { description: unread[0] },
      );
    }

    return {
      isPlaylist: false,
      playlistId: null,
      playlistTitle: null,
      entries: [...merged.values()],
    };
  };

  const fetchPreview = async (urlArg?: string) => {
    const urls = urlArg !== undefined && urlArg !== '' ? parseUrls(urlArg) : parseUrls(url);
    if (urls.length === 0 || busy) {
      return;
    }
    setUrl(urls.join('\n'));
    setBusy(true);
    try {
      const [p, alreadyImported] = await Promise.all([
        urls.length === 1 ? probeImport(urls[0]) : probeAll(urls),
        importedVideoIds(),
      ]);
      if (p.entries.length === 0) {
        toast.error(urls.length === 1 ? 'No videos found at that URL.' : 'No videos found.');
        return;
      }
      const done = new Set(alreadyImported);
      setPreview(p);
      setImported(done);
      // Check only the new tracks — already-imported entries stay unticked so a
      // re-import is a clean delta by default. (Re-download still works if ticked.)
      setSelected(new Set(p.entries.filter((e) => !done.has(e.id)).map((e) => e.id)));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setProbed(null);
      setBusy(false);
    }
  };

  // A link copied in the YouTube window joins the box as another line; the
  // window stays open so more can follow.
  const appendUrl = (link: string) =>
    setUrl((prev) => {
      const lines = parseUrls(prev);
      return lines.includes(link) ? prev : [...lines, link].join('\n');
    });

  const { openYoutube } = useYoutubeWindow({ active: preview === null, onUrl: appendUrl });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  // Select/deselect act on the whole preview, not the filtered view: the filter
  // is for finding a track, and a hidden row stays selected either way.
  const selectAll = () => setSelected(new Set(preview?.entries.map((e) => e.id) ?? []));
  const deselectAll = () => setSelected(new Set());

  const editDraft = (id: string, patch: Partial<{ title: string; artist: string }>) =>
    setPreview((p) =>
      p === null
        ? p
        : { ...p, entries: p.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) },
    );

  /** Hand the ticked drafts to the queue. The worker picks them up in turn. */
  const enqueueDrafts = async () => {
    if (preview === null || busy || selectedCount === 0) {
      return;
    }
    setBusy(true);
    try {
      const entries = preview.entries.filter((e) => selected.has(e.id));
      // Remember playlists so they can be re-imported (delta) for new tracks.
      if (preview.isPlaylist) {
        saveLastPlaylist({ url: url.trim(), title: preview.playlistTitle ?? '' });
      }
      await startImport({ ...preview, entries });
      setPreview(null);
      setSelected(new Set());
      setUrl('');
      await refreshQueue();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Queue the failed rows again. A video already on disk is skipped by the
   * folder manifest without downloading, so re-submitting costs nothing beyond
   * the entries that actually need another try.
   */
  const retryFailed = async () => {
    const failed = failedRows(queueRows);
    if (failed.length === 0 || busy) {
      return;
    }
    setBusy(true);
    try {
      await startImport({
        isPlaylist: failed[0].playlistId !== null,
        playlistId: failed[0].playlistId,
        playlistTitle: failed[0].playlistTitle,
        entries: failed.map((row) => ({
          id: row.id,
          title: row.title,
          artist: row.artist,
          durationSecs: row.durationSecs,
        })),
      });
      await refreshQueue();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const clearFinished = async () => {
    try {
      await clearFinishedImports();
      await refreshQueue();
    } catch (e) {
      toast.error(String(e));
    }
  };

  // Controller/keyboard ring. `useNavStops` reads the segments back off the DOM
  // rather than counting them here, because half this page's controls disable
  // themselves and so drop in and out of the ring.
  const containerRef = useRef<HTMLDivElement>(null);
  const stops = useNavStops(containerRef);
  const itemCount = stops.reduce((sum, n) => sum + n, 0);

  useDialogNav({
    open: true,
    itemCount,
    stops,
    onBack: () => void close(),
    containerRef,
  });

  return (
    <div
      className="flex h-full flex-col overflow-hidden px-4 pb-5 pt-14 sm:px-6 md:pt-5 lg:px-8"
      ref={containerRef}
    >
      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
            <YoutubeIcon className="size-5 shrink-0" /> Import
          </h1>
          <p className="text-sm text-muted-foreground">
            Download a YouTube video or playlist into your folder library. It runs in the background
            through the normal karaoke pipeline — vocal separation and synced lyrics — like any
            local file.
          </p>
        </div>

        {!checkingAvailable && available !== true && <ImportUnavailable />}

        {!checkingAvailable && available === true && (
          <>
            <ImportUrlForm
              busy={busy}
              filter={filter}
              lastPlaylist={lastPlaylist}
              onBrowse={openYoutube}
              onDeselectAll={deselectAll}
              onFetch={(urlArg) => void fetchPreview(urlArg)}
              onFilterChange={onFilterChange}
              onSelectAll={selectAll}
              onUrlChange={setUrl}
              selectedCount={selectedCount}
              url={url}
            />

            <ImportQueueTable
              imported={imported}
              onEdit={editDraft}
              onToggle={toggle}
              progressById={progressById}
              rows={rows}
              selected={selected}
            />
          </>
        )}

        <ImportFooter
          available={available}
          busy={busy}
          draftCount={drafts.length}
          failedCount={failedRows(queueRows).length}
          finishedCount={finishedRows(queueRows).length}
          onClearFinished={() => void clearFinished()}
          onClose={() => void close()}
          onEnqueue={() => void enqueueDrafts()}
          onFetch={() => void fetchPreview()}
          onRetryFailed={() => void retryFailed()}
          probed={probed}
          selectedCount={selectedCount}
          url={url}
        />
      </div>
    </div>
  );
};
