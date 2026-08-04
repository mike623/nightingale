import { Loader2Icon, YoutubeIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { probeImport, startImport } from "@/bridge/import";
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
import { useDialog } from "@/hooks/use-dialog";
import type { ImportPreview } from "@/types/ImportPreview";

type Step = "input" | "preview";

export const ImportUrlDialog = () => {
  const { mode, close } = useDialog();
  const open = mode === "import-url";

  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const step: Step = preview ? "preview" : "input";
  const single = preview && !preview.isPlaylist ? preview.entries[0] : null;
  const selectedCount = selected.size;
  const allSelected = preview ? selectedCount === preview.entries.length : false;

  const onClose = () => {
    setUrl("");
    setPreview(null);
    setSelected(new Set());
    setBusy(false);
    close();
  };

  const fetchPreview = async () => {
    const trimmed = url.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const p = await probeImport(trimmed);
      if (p.entries.length === 0) {
        toast.error("No videos found at that URL.");
        return;
      }
      setPreview(p);
      // Everything checked by default — the user unticks what they don't want.
      setSelected(new Set(p.entries.map((e) => e.id)));
    } catch (e) {
      toast.error(String(e));
    } finally {
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

  const toggleAll = () =>
    setSelected((prev) =>
      preview && prev.size < preview.entries.length
        ? new Set(preview.entries.map((e) => e.id))
        : new Set(),
    );

  // Fire-and-forget: kick off the background download and close. Progress and
  // the final result surface as a toast (see useImportNotifications).
  const doImport = async () => {
    if (!preview || busy || selectedCount === 0) return;
    setBusy(true);
    try {
      const entries = preview.entries.filter((e) => selected.has(e.id));
      await startImport({ ...preview, entries });
      toast.loading(`Importing ${entries.length} track${entries.length === 1 ? "" : "s"}…`, {
        id: "youtube-import",
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
      <DialogContent>
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
          <div className="space-y-2">
            <Label htmlFor="import-url">YouTube URL</Label>
            <Input
              id="import-url"
              value={url}
              placeholder="https://www.youtube.com/watch?v=…"
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") fetchPreview();
              }}
              autoFocus
            />
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
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  Playlist{preview.playlistTitle ? ` “${preview.playlistTitle}”` : ""} — pick tracks
                  to import.
                </span>
                <button
                  type="button"
                  className="text-xs underline underline-offset-2 hover:text-foreground"
                  onClick={toggleAll}
                >
                  {allSelected ? "Deselect all" : "Select all"}
                </button>
              </div>
              <ul className="max-h-56 overflow-y-auto rounded-md border p-1 text-sm">
                {preview.entries.map((e) => (
                  <li key={e.id}>
                    <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-accent">
                      <Checkbox checked={selected.has(e.id)} onCheckedChange={() => toggle(e.id)} />
                      <span className="truncate">
                        {e.artist ? `${e.artist} — ` : ""}
                        {e.title}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}

        <DialogFooter>
          {step === "input" && (
            <Button onClick={fetchPreview} disabled={busy || !url.trim()}>
              {busy && <Loader2Icon className="size-4 animate-spin" />} Fetch
            </Button>
          )}
          {step === "preview" && (
            <>
              <Button variant="ghost" onClick={() => setPreview(null)} disabled={busy}>
                Back
              </Button>
              <Button
                onClick={doImport}
                disabled={busy || (!!preview?.isPlaylist && selectedCount === 0)}
              >
                {busy && <Loader2Icon className="size-4 animate-spin" />}
                {preview?.isPlaylist ? `Import (${selectedCount})` : "Import"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
