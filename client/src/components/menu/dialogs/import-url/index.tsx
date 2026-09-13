import { Loader2Icon, YoutubeIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { IMPORT_TOAST_ID, importedVideoIds, probeImport, startImport } from "@/bridge/import";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDialog } from "@/hooks/use-dialog";
import { readLastPlaylist, saveLastPlaylist } from "@/lib/last-playlist";
import type { ImportEntry } from "@/types/ImportEntry";
import type { ImportPreview } from "@/types/ImportPreview";
import { RotateCcwIcon } from "lucide-react";

type Step = "input" | "preview";

/**
 * How many links are probed at once. Each probe is its own yt-dlp process and
 * the time goes on the network round-trip, so overlapping a few is most of the
 * win; the cap is what keeps a long paste from spawning a process per line.
 */
const PROBE_CONCURRENCY = 5;

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

export const ImportUrlDialog = () => {
  const { mode, close } = useDialog();
  const open = mode === "import-url";

  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Video ids already on disk — shown as "Imported" and unchecked by default.
  const [imported, setImported] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // Probing several links takes a while (a yt-dlp process each), so it reports progress.
  const [probed, setProbed] = useState<{ done: number; total: number } | null>(null);

  const step: Step = preview ? "preview" : "input";
  // A lone video is editable; anything longer is a pick-list.
  const single =
    preview && !preview.isPlaylist && preview.entries.length === 1 ? preview.entries[0] : null;
  const selectedCount = selected.size;
  const allSelected = preview ? selectedCount === preview.entries.length : false;

  const onClose = () => {
    setUrl("");
    setPreview(null);
    setSelected(new Set());
    setImported(new Set());
    setProbed(null);
    setBusy(false);
    close();
  };

  const lastPlaylist = open ? readLastPlaylist() : null;

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

  const selectAll = () => setSelected(new Set(preview?.entries.map((e) => e.id) ?? []));
  const deselectAll = () => setSelected(new Set());

  // Fire-and-forget: kick off the background download and close. Progress and
  // the final result surface as a toast (see useImportNotifications).
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
      await startImport({ ...preview, entries });
      toast.loading(`Importing ${entries.length} track${entries.length === 1 ? "" : "s"}…`, {
        id: IMPORT_TOAST_ID,
      });
      onClose();
    } catch (e) {
      toast.error(String(e));
      setBusy(false);
    }
  };

  const editSingle = (patch: Partial<{ title: string; artist: string }>) =>
    setPreview((p) =>
      p && !p.isPlaylist ? { ...p, entries: [{ ...p.entries[0], ...patch }] } : p,
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="h-[80vh] w-[80vw] max-w-[80vw] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-[80vw]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <YoutubeIcon className="size-5" /> Import from URL
          </DialogTitle>
          <DialogDescription>
            Download a YouTube video or playlist into your folder library. It runs in the background
            through the normal karaoke pipeline — vocal separation and synced lyrics — like any
            local file.
          </DialogDescription>
        </DialogHeader>

        {step === "input" && (
          <div className="flex min-h-0 flex-col gap-2">
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
              autoFocus
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
                onClick={() => fetchPreview(lastPlaylist.url)}
              >
                <RotateCcwIcon className="size-4 shrink-0" />
                <span className="truncate">
                  Re-import last playlist{lastPlaylist.title ? `: ${lastPlaylist.title}` : ""}
                </span>
              </Button>
            )}
          </div>
        )}

        {step === "preview" &&
          preview &&
          (single ? (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="import-title">Title</Label>
                <Input
                  id="import-title"
                  value={single.title}
                  onChange={(e) => editSingle({ title: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="import-artist">Artist</Label>
                <Input
                  id="import-artist"
                  value={single.artist}
                  onChange={(e) => editSingle({ artist: e.target.value })}
                />
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-col gap-2">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
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
              <ul className="min-h-0 flex-1 overflow-y-auto rounded-md border p-1 text-sm">
                {preview.entries.map((e) => (
                  <li key={e.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-accent">
                      <Checkbox checked={selected.has(e.id)} onCheckedChange={() => toggle(e.id)} />
                      <span
                        className={`truncate ${imported.has(e.id) ? "text-muted-foreground" : ""}`}
                      >
                        {e.artist ? `${e.artist} — ` : ""}
                        {e.title}
                      </span>
                      {imported.has(e.id) && (
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                          Imported
                        </span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}

        <DialogFooter className="sm:justify-start">
          {step === "input" && (
            <Button onClick={() => fetchPreview()} disabled={busy || !url.trim()}>
              {busy && <Loader2Icon className="size-4 animate-spin" />}
              {probed ? `Fetching ${probed.done}/${probed.total}…` : "Fetch"}
            </Button>
          )}
          {step === "preview" && (
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
