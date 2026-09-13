import { Loader2Icon, RotateCcwIcon, YoutubeIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { importedVideoIds, probeImport, startImport } from "@/bridge/import";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { DIALOG_FOCUSABLE_SELECTOR, useDialogNav } from "@/hooks/navigation/use-dialog-nav";
import { useBeginImport, useClearImport, useImportState } from "@/hooks/use-import-state";
import { useImportAvailable } from "@/queries/use-import-available";
import { readLastPlaylist, saveLastPlaylist } from "@/lib/last-playlist";
import type { ImportEntry } from "@/types/ImportEntry";
import type { ImportEntryProgress } from "@/types/ImportEntryProgress";
import type { ImportPreview } from "@/types/ImportPreview";

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
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ];
}

/** Per-row status pill + bar. `progress` is undefined until the entry is reached. */
function EntryProgress({
  progress,
  alreadyImported,
}: {
  progress: ImportEntryProgress | undefined;
  alreadyImported: boolean;
}) {
  if (!progress) {
    return alreadyImported ? (
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">Imported</span>
    ) : null;
  }

  if (progress.status === "Downloading") {
    return (
      <span className="ml-auto flex w-32 shrink-0 items-center gap-2">
        <Progress value={progress.pct * 100} max={100} className="flex-1" />
        <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {Math.round(progress.pct * 100)}%
        </span>
      </span>
    );
  }

  const variant = progress.status === "Failed" ? "destructive" : "secondary";

  return (
    <Badge variant={variant} className="ml-auto shrink-0" title={progress.reason ?? undefined}>
      {progress.status}
    </Badge>
  );
}

export const ImportPage = () => {
  const navigate = useNavigate();
  const close = () => navigate("/");

  const { data: available, isLoading: checkingAvailable } = useImportAvailable();
  const beginImport = useBeginImport();
  const clearImport = useClearImport();
  const { preview: runningPreview, progressById, aggregate, running, report } = useImportState();

  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Video ids already on disk — shown as "Imported" and unchecked by default.
  const [imported, setImported] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // Probing several links takes a while (a yt-dlp process each), so it reports progress.
  const [probed, setProbed] = useState<{ done: number; total: number } | null>(null);
  const [filter, setFilter] = useState("");

  const filterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(filterTimer.current ?? undefined), []);

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
    if (!needle) return entries;
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

    // Each worker takes the next index until the list runs out. `next++` needs
    // no lock: nothing awaits between reading and incrementing it.
    const worker = async () => {
      for (let index = next++; index < urls.length; index = next++) {
        try {
          results[index] = await probeImport(urls[index]);
        } catch (e) {
          failures[index] = `${urls[index]}: ${String(e)}`;
        }
        completed += 1;
        setProbed({ done: completed, total: urls.length });
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(PROBE_CONCURRENCY, urls.length) }, () => worker()),
    );

    const merged = new Map<string, ImportEntry>();
    results.forEach((p) => {
      // A later duplicate keeps the first entry: same video id, same file.
      p?.entries.forEach((entry) => {
        if (!merged.has(entry.id)) merged.set(entry.id, entry);
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
    const urls = urlArg ? parseUrls(urlArg) : parseUrls(url);
    if (urls.length === 0 || busy) return;
    setUrl(urls.join("\n"));
    setBusy(true);
    try {
      const [p, alreadyImported] = await Promise.all([
        urls.length === 1 ? probeImport(urls[0]) : probeAll(urls),
        importedVideoIds(),
      ]);
      if (p.entries.length === 0) {
        toast.error(urls.length === 1 ? "No videos found at that URL." : "No videos found.");
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
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Select/deselect act on the whole preview, not the filtered view: the filter
  // is for finding a track, and a hidden row stays selected either way.
  const selectAll = () => setSelected(new Set(preview?.entries.map((e) => e.id) ?? []));
  const deselectAll = () => setSelected(new Set());

  // Fire-and-forget: kick off the background download. Progress arrives on the
  // import atoms (see useImportNotifications) and renders in the rows below.
  const doImport = async () => {
    if (!preview || busy || (!single && selectedCount === 0)) return;
    setBusy(true);
    try {
      // A single video imports itself even when it is already on disk (an
      // explicit re-download); a pick-list imports exactly what is ticked.
      const entries = single ? preview.entries : preview.entries.filter((e) => selected.has(e.id));
      // Remember playlists so they can be re-imported (delta) for new tracks.
      if (preview.isPlaylist) {
        saveLastPlaylist({ url: url.trim(), title: preview.playlistTitle ?? "" });
      }
      const started = { ...preview, entries };
      beginImport(started);
      await startImport(started);
      // Hand the view over to the running import; the local draft is spent.
      setPreview(null);
      setUrl("");
      setFilter("");
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

  // Controller/keyboard ring.
  //
  // `useDialogNav` requires `stops` to sum to exactly the *visible, enabled*
  // focusables under `containerRef`, in DOM order — and half this page's
  // controls disable themselves (Fetch with an empty box, Select all when
  // everything is ticked, Import with nothing ticked), which drops them from
  // `DIALOG_FOCUSABLE_SELECTOR`. Hand-counting segments here would silently
  // desync the ring the moment one of those flipped.
  //
  // So read the segments back off the DOM instead: each focusable inherits a
  // `data-nav-group` from its nearest tagged ancestor, and consecutive
  // focusables sharing a group collapse into one segment (up/down moves between
  // segments, left/right within one). Rows tag themselves per id, so each gets
  // its own segment and up/down walks the list. Adding a control means tagging
  // it, not updating a count.
  const containerRef = useRef<HTMLDivElement>(null);
  const [stops, setStops] = useState<number[]>([1]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const focusables = Array.from(
      container.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR),
    ).filter((el) => el.offsetWidth > 0 || el.offsetHeight > 0);

    const next: number[] = [];
    let lastGroup: string | null = null;
    for (const el of focusables) {
      const group = el.closest<HTMLElement>("[data-nav-group]")?.dataset.navGroup ?? "";
      // An untagged focusable never merges, so a missed tag costs one extra
      // segment rather than a misaligned ring.
      if (group === "" || group !== lastGroup) {
        next.push(1);
        lastGroup = group === "" ? null : group;
      } else {
        next[next.length - 1] += 1;
      }
    }

    const resolved = next.length > 0 ? next : [1];
    setStops((prev) =>
      prev.length === resolved.length && prev.every((n, i) => n === resolved[i]) ? prev : resolved,
    );
  });

  const itemCount = stops.reduce((sum, n) => sum + n, 0);

  useDialogNav({
    open: true,
    itemCount,
    stops,
    onBack: close,
    containerRef,
  });

  const body = () => {
    if (checkingAvailable) return null;

    if (!available) {
      return (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Import needs a folder library</EmptyTitle>
            <EmptyDescription>
              Imported files are written into the watched folder, so Import is only available when
              your library is a folder — not a Plex, Jellyfin, or Navidrome server.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      );
    }

    // A run in flight (or just finished) takes over the view.
    if (shown && !preview) {
      return (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-3" data-nav-group="filter">
            <Input
              defaultValue={filter}
              placeholder="Search tracks"
              aria-label="Search tracks"
              className="min-w-0 flex-1"
              onChange={(e) => {
                const value = e.target.value;
                clearTimeout(filterTimer.current ?? undefined);
                filterTimer.current = setTimeout(() => setFilter(value), FILTER_DEBOUNCE_MS);
              }}
            />
            {aggregate && (
              <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                {aggregate.done}/{aggregate.total}
              </span>
            )}
          </div>
          {rows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No tracks match your search</EmptyTitle>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto rounded-md border p-1 text-sm">
              {rows.map((e) => (
                <li key={e.id}>
                  <div className="flex items-center gap-2 rounded px-1 py-1">
                    <span className="truncate">
                      {e.artist ? `${e.artist} — ` : ""}
                      {e.title}
                    </span>
                    <EntryProgress
                      progress={progressById[e.id]}
                      alreadyImported={imported.has(e.id)}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    }

    if (!preview) {
      return (
        <div className="flex min-h-0 flex-1 flex-col gap-2" data-nav-group="url">
          <Label htmlFor="import-url">YouTube URLs</Label>
          <Textarea
            id="import-url"
            value={url}
            rows={4}
            className="min-h-0 flex-1 overflow-y-auto"
            placeholder={
              "https://www.youtube.com/watch?v=…\nhttps://youtu.be/…\nhttps://music.youtube.com/playlist?list=…"
            }
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              // Enter types a newline here, so submitting takes the modifier.
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) fetchPreview();
            }}
          />
          <p className="text-xs text-muted-foreground">
            One link per line. A single playlist link keeps its playlist; several links import as
            individual videos.
          </p>
          {lastPlaylist && (
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              disabled={busy}
              data-nav-group="reimport"
              onClick={() => fetchPreview(lastPlaylist.url)}
            >
              <RotateCcwIcon className="size-4 shrink-0" />
              <span className="truncate">
                Re-import last playlist{lastPlaylist.title ? `: ${lastPlaylist.title}` : ""}
              </span>
            </Button>
          )}
        </div>
      );
    }

    if (single) {
      return (
        <div className="space-y-3">
          <div className="space-y-1" data-nav-group="title">
            <Label htmlFor="import-title">Title</Label>
            <Input
              id="import-title"
              value={single.title}
              onChange={(e) => editSingle({ title: e.target.value })}
            />
          </div>
          <div className="space-y-1" data-nav-group="artist">
            <Label htmlFor="import-artist">Artist</Label>
            <Input
              id="import-artist"
              value={single.artist}
              onChange={(e) => editSingle({ artist: e.target.value })}
            />
          </div>
        </div>
      );
    }

    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <Input
          defaultValue={filter}
          placeholder="Search tracks"
          aria-label="Search tracks"
          className="min-w-0"
          data-nav-group="filter"
          onChange={(e) => {
            const value = e.target.value;
            clearTimeout(filterTimer.current ?? undefined);
            filterTimer.current = setTimeout(() => setFilter(value), FILTER_DEBOUNCE_MS);
          }}
        />
        <div
          className="flex items-center gap-3 text-sm text-muted-foreground"
          data-nav-group="select"
        >
          <button
            type="button"
            className="shrink-0 text-xs underline underline-offset-2 hover:text-foreground disabled:no-underline disabled:opacity-50"
            disabled={allSelected}
            onClick={selectAll}
          >
            Select all
          </button>
          <button
            type="button"
            className="shrink-0 text-xs underline underline-offset-2 hover:text-foreground disabled:no-underline disabled:opacity-50"
            disabled={selectedCount === 0}
            onClick={deselectAll}
          >
            Deselect all
          </button>
          <span className="truncate">
            {preview.isPlaylist
              ? `Playlist${preview.playlistTitle ? ` “${preview.playlistTitle}”` : ""} — pick tracks to import.`
              : `${preview.entries.length} videos — pick tracks to import.`}
          </span>
        </div>
        {rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>No tracks match your search</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto rounded-md border p-1 text-sm">
            {rows.map((e) => (
              <li key={e.id} data-nav-group={`row:${e.id}`}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-accent">
                  <Checkbox checked={selected.has(e.id)} onCheckedChange={() => toggle(e.id)} />
                  <span className={`truncate ${imported.has(e.id) ? "text-muted-foreground" : ""}`}>
                    {e.artist ? `${e.artist} — ` : ""}
                    {e.title}
                  </span>
                  {imported.has(e.id) && (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">Imported</span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

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

        {body()}

        <div
          className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end"
          data-nav-group="footer"
        >
          {available && !shown && !preview && (
            <Button onClick={() => fetchPreview()} disabled={busy || !url.trim()}>
              {busy && <Loader2Icon className="size-4 animate-spin" />}
              {probed ? `Fetching ${probed.done}/${probed.total}…` : "Fetch"}
            </Button>
          )}
          {/* The finished run holds the view; this is the way back to the form. */}
          {available && shown && !preview && report && (
            <Button onClick={clearImport}>New import</Button>
          )}
          {available && preview && (
            <>
              <Button onClick={doImport} disabled={busy || (!single && selectedCount === 0)}>
                {busy && <Loader2Icon className="size-4 animate-spin" />}
                {single ? "Import" : `Import (${selectedCount})`}
              </Button>
              <Button variant="ghost" onClick={() => setPreview(null)} disabled={busy}>
                Back
              </Button>
            </>
          )}
          <Button variant="outline" onClick={close}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
};
