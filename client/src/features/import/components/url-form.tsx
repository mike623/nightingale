import { RotateCcwIcon, YoutubeIcon } from 'lucide-react';

import type { LastPlaylist } from '@/features/import/lib/last-playlist';
import { Button } from '@/shared/components/ui/button';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';

type ImportUrlFormProps = {
  url: string;
  busy: boolean;
  lastPlaylist: LastPlaylist | null;
  onUrlChange: (value: string) => void;
  onFetch: (url?: string) => void;
  onBrowse: () => void;
};

export const ImportUrlForm = ({
  url,
  busy,
  lastPlaylist,
  onUrlChange,
  onFetch,
  onBrowse,
}: ImportUrlFormProps) => (
  <div className="flex min-h-0 flex-1 flex-col gap-2" data-nav-group="url">
    <Label htmlFor="import-url">YouTube URLs</Label>
    <div className="flex min-h-0 flex-1 gap-2">
      <Textarea
        id="import-url"
        value={url}
        rows={4}
        className="min-h-0 flex-1 overflow-y-auto"
        placeholder={
          'https://www.youtube.com/watch?v=…\nhttps://youtu.be/…\nhttps://music.youtube.com/playlist?list=…'
        }
        onChange={(e) => onUrlChange(e.target.value)}
        onKeyDown={(e) => {
          // Enter types a newline here, so submitting takes the modifier.
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            onFetch();
          }
        }}
      />
      <Button variant="outline" size="sm" className="shrink-0 self-start" onClick={onBrowse}>
        <YoutubeIcon className="size-4 shrink-0" />
        Browse
      </Button>
    </div>
    <p className="text-xs text-muted-foreground">
      One link per line. A single playlist link keeps its playlist; several links import as
      individual videos. Browse opens YouTube in its own window: copy a video or playlist link there
      and it lands here.
    </p>
    {lastPlaylist && (
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start"
        disabled={busy}
        data-nav-group="reimport"
        onClick={() => onFetch(lastPlaylist.url)}
      >
        <RotateCcwIcon className="size-4 shrink-0" />
        <span className="truncate">
          Re-import last playlist{lastPlaylist.title ? `: ${lastPlaylist.title}` : ''}
        </span>
      </Button>
    )}
  </div>
);
