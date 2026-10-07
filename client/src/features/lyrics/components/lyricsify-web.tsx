import { ExternalLinkIcon } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

import { ringFor } from './parts';

type LyricsifyWebProps = {
  onOpen: () => void;
  focused: boolean;
};

export const LyricsifyWeb = ({ onOpen, focused }: LyricsifyWebProps) => (
  <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-md border p-6 text-center">
    <p className="text-sm">Lyricsify opens in its own window.</p>
    <p className="text-muted-foreground max-w-sm text-xs">
      The site refuses to be embedded, so it needs a window of its own. Copy the lyrics you find
      there into the Edit tab.
    </p>
    <Button variant="outline" size="sm" onClick={onOpen} className={ringFor(focused)}>
      <ExternalLinkIcon className="size-3" />
      Open Lyricsify
    </Button>
  </div>
);
