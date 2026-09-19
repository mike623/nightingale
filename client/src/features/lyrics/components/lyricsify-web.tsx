import { ExternalLinkIcon } from 'lucide-react';

import { openUrl } from '@/bridge/opener';
import { Button } from '@/shared/components/ui/button';

import { ringFor } from './parts';

type LyricsifyWebProps = {
  url: string;
  focused: boolean;
};

export const LyricsifyWeb = ({ url, focused }: LyricsifyWebProps) => (
  <div className="flex min-h-0 flex-1 flex-col gap-2">
    <iframe
      // The rule guards against framed content dropping its own sandbox, which
      // needs the frame to share this document's origin. `src` is a fixed
      // remote https origin, pinned by the Tauri `frame-src` policy, so
      // `allow-same-origin` grants the site its own origin only and never
      // Nightingale's. The site needs its scripts and that origin's storage to
      // clear its bot check; without both the frame stays blank.
      // oxlint-disable-next-line react/iframe-missing-sandbox
      sandbox="allow-scripts allow-same-origin allow-forms"
      referrerPolicy="no-referrer"
      src={url}
      title="Lyricsify"
      className="min-h-0 w-full flex-1 rounded-md border bg-white"
    />
    <div className="flex items-center justify-between gap-2">
      <p className="text-muted-foreground text-xs">Copy lyrics from the page into the Edit tab.</p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void openUrl(url);
        }}
        className={ringFor(focused)}
      >
        <ExternalLinkIcon className="size-3" />
        Open in browser
      </Button>
    </div>
  </div>
);
