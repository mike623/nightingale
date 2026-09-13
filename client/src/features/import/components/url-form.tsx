import { RotateCcwIcon } from 'lucide-react';

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
};

export const ImportUrlForm = ({
  url,
  busy,
  lastPlaylist,
  onUrlChange,
  onFetch,
}: ImportUrlFormProps) => (
  <div className="flex min-h-0 flex-1 flex-col gap-2" data-nav-group="url">
    <Label htmlFor="import-url">YouTube URLs</Label>
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
