import { YoutubeIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import { importedVideoIds, probeImport, startImport } from '@/bridge/import';
import { ImportBody } from '@/features/import/components/body';
import { ImportFooter } from '@/features/import/components/footer';
import {
  useBeginImport,
  useClearImport,
  useImportState,
} from '@/features/import/hooks/use-import-state';
import { useNavStops } from '@/features/import/hooks/use-nav-stops';
import { readLastPlaylist, saveLastPlaylist } from '@/features/import/lib/last-playlist';
import { useImportAvailable } from '@/features/import/queries/use-import-available';
import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
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

  const { data: available, isLoading: checkingAvailable } = useImportAvailable();
  const beginImport = useBeginImport();
  const clearImport = useClearImport();
  const { preview: runningPreview, progressById, aggregate, running, report } = useImportState();

  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Video ids already on disk — shown as "Imported" and unchecked by default.
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

  // A run started earlier (possibly before this page mounted) owns the view:
  // its entries are what the progress rows belong to.
  const shown = running || (runningPreview && !preview) ? runningPreview : preview;

  // A lone video is editable; anything longer is a pick-list.
  const single =
    preview && !preview.isPlaylist && preview.entries.length === 1 ? preview.entries[0] : null;
  const selectedCount = selected.size;
  const allSelected = preview ? selectedCount === preview.entries.length : false;

  const rows = useMemo(() => {
    const entries = shown?.entries ?? [];
    const needle = filter.trim().toLowerCase();
    if (!needle) {
      return entries;
    }
    return entries.filter((e) => `${e.artist} ${e.title}`.toLowerCase().includes(needle));
  }, [shown, filter]);

  const lastPlaylist = readLastPlaylist();

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

  // Fire-and-forget: kick off the background download. Progress arrives on the
  // import atoms (see useImportNotifications) and renders in the rows below.
  const doImport = async () => {
    if (!preview || busy || (!single && selectedCount === 0)) {
      return;
    }
    setBusy(true);
    try {
      // A single video imports itself even when it is already on disk (an
      // explicit re-download); a pick-list imports exactly what is ticked.
      const entries = single ? preview.entries : preview.entries.filter((e) => selected.has(e.id));
      // Remember playlists so they can be re-imported (delta) for new tracks.
      if (preview.isPlaylist) {
        saveLastPlaylist({ url: url.trim(), title: preview.playlistTitle ?? '' });
      }
      const started = { ...preview, entries };
      beginImport(started);
      await startImport(started);
      // Hand the view over to the running import; the local draft is spent.
      setPreview(null);
      setUrl('');
      setFilter('');
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  };

  const editSingle = (patch: Partial<{ title: string; artist: string }>) =>
    setPreview((p) =>
      p && !p.isPlaylist ? { ...p, entries: [{ ...p.entries[0], ...patch }] } : p,
    );

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
      ref={containerRef}
      className="flex h-full flex-col overflow-y-auto px-4 pb-5 pt-14 sm:px-6 md:pt-5 lg:px-8"
    >
      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-5">
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

        <ImportBody
          checkingAvailable={checkingAvailable}
          available={available}
          shown={shown}
          preview={preview}
          single={single}
          rows={rows}
          filter={filter}
          url={url}
          busy={busy}
          lastPlaylist={lastPlaylist}
          aggregate={aggregate}
          progressById={progressById}
          imported={imported}
          selected={selected}
          allSelected={allSelected}
          selectedCount={selectedCount}
          onFilterChange={onFilterChange}
          onUrlChange={setUrl}
          onFetch={(urlArg) => void fetchPreview(urlArg)}
          onEditSingle={editSingle}
          onToggle={toggle}
          onSelectAll={selectAll}
          onDeselectAll={deselectAll}
        />

        <ImportFooter
          available={available}
          hasRun={shown !== null}
          hasPreview={preview !== null}
          hasReport={report !== null}
          isSingle={single !== null}
          busy={busy}
          url={url}
          probed={probed}
          selectedCount={selectedCount}
          onFetch={() => void fetchPreview()}
          onNewImport={clearImport}
          onImport={() => void doImport()}
          onBack={() => setPreview(null)}
          onClose={() => void close()}
        />
      </div>
    </div>
  );
};
