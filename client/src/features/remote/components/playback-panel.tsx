import { ShuffleIcon } from 'lucide-react';

import type { RemoteCommand, RemoteSnapshot } from '@/bridge/remote';
import { GuideSection } from '@/features/remote/components/guide-section';
import { NowPlaying } from '@/features/remote/components/now-playing';
import { OptionsSection } from '@/features/remote/components/options-section';
import { TransportSection } from '@/features/remote/components/transport-section';
import { TOUCH_TARGET } from '@/features/remote/lib/touch-target';
import { Button } from '@/shared/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/shared/components/ui/empty';
import { cn } from '@/shared/utils/cn';

type PlaybackPanelProps = {
  snapshot: RemoteSnapshot | null;
  positionMs: number;
  /** True while no command can reach a host, whatever the reason. */
  locked: boolean;
  send: (command: RemoteCommand) => void;
};

/** Everything that acts on the song the host is playing right now. */
export const PlaybackPanel = ({ snapshot, positionMs, locked, send }: PlaybackPanelProps) => {
  if (snapshot === null) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Nothing is playing</EmptyTitle>
          <EmptyDescription>
            Pick a song from the Library tab, or let the host choose one for the room.
          </EmptyDescription>
        </EmptyHeader>

        <EmptyContent>
          <Button
            className={cn(TOUCH_TARGET, 'w-full')}
            disabled={locked}
            onClick={() => send({ action: 'start_random' })}
            type="button"
            variant="outline"
          >
            <ShuffleIcon />
            Play something
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <>
      <NowPlaying snapshot={snapshot} />
      <TransportSection disabled={locked} positionMs={positionMs} send={send} snapshot={snapshot} />
      <GuideSection disabled={locked} send={send} snapshot={snapshot} />
      <OptionsSection disabled={locked} send={send} snapshot={snapshot} />
    </>
  );
};
