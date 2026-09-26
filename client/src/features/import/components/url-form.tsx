import { RotateCcwIcon, SearchIcon, YoutubeIcon } from 'lucide-react';

import type { LastPlaylist } from '@/features/import/lib/last-playlist';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';

type ImportUrlFormProps = {
  url: string;
  filter: string;
  busy: boolean;
  selectedCount: number;
  lastPlaylist: LastPlaylist | null;
  onUrlChange: (value: string) => void;
  onFilterChange: (value: string) => void;
  onFetch: (url?: string) => void;
  onBrowse: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
};

/**
 * Where links come in, kept to a fixed height: the queue below is what the page
 * is mostly for, and the box only ever holds a few lines before they are
 * resolved into rows.
 */
export const ImportUrlForm = ({
  url,
  filter,
  busy,
  selectedCount,
  lastPlaylist,
  onUrlChange,
  onFilterChange,
  onFetch,
  onBrowse,
  onSelectAll,
  onDeselectAll,
}: ImportUrlFormProps) => (
  <div className="flex shrink-0 flex-col gap-2">
    <div className="flex items-start gap-2" data-nav-group="url">
      <div className="min-w-0 flex-1 space-y-1">
        <Label htmlFor="import-url">YouTube URLs</Label>
        <Textarea
          className="resize-none"
          id="import-url"
          onChange={(e) => onUrlChange(e.target.value)}
          onKeyDown={(e) => {
            // Enter types a newline here, so submitting takes the modifier.
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              onFetch();
            }
          }}
          placeholder={
            'https://www.youtube.com/watch?v=…\nhttps://music.youtube.com/playlist?list=…'
          }
          rows={2}
          value={url}
        />
      </div>
      <Button className="mt-6 shrink-0" onClick={onBrowse} size="sm" variant="outline">
        <YoutubeIcon className="size-4 shrink-0" />
        Browse
      </Button>
    </div>

    <p className="text-xs text-muted-foreground">
      One link per line. A single playlist link keeps its playlist; several links import as
      individual videos. Browse opens YouTube in its own window: copy a link there and it lands
      here.
    </p>

    {lastPlaylist && (
      <Button
        className="w-full justify-start"
        data-nav-group="reimport"
        disabled={busy}
        onClick={() => onFetch(lastPlaylist.url)}
        size="sm"
        variant="outline"
      >
        <RotateCcwIcon className="size-4 shrink-0" />
        <span className="truncate">
          Re-import last playlist{lastPlaylist.title ? `: ${lastPlaylist.title}` : ''}
        </span>
      </Button>
    )}

    <div className="flex items-center gap-3" data-nav-group="filter">
      <div className="relative min-w-0 flex-1">
        <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Search the queue"
          className="pl-9"
          defaultValue={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          placeholder="Search the queue"
          type="search"
        />
      </div>
      <button
        className="shrink-0 text-xs underline underline-offset-2 hover:text-foreground disabled:no-underline disabled:opacity-50"
        onClick={onSelectAll}
        type="button"
      >
        Select all
      </button>
      <button
        className="shrink-0 text-xs underline underline-offset-2 hover:text-foreground disabled:no-underline disabled:opacity-50"
        disabled={selectedCount === 0}
        onClick={onDeselectAll}
        type="button"
      >
        Deselect all
      </button>
    </div>
  </div>
);
