import type { RemoteCommand, RemoteSnapshot } from '@/bridge/remote';
import { GuideSection } from '@/features/remote/components/guide-section';
import { NowPlaying } from '@/features/remote/components/now-playing';
import { OptionsSection } from '@/features/remote/components/options-section';
import { TransportSection } from '@/features/remote/components/transport-section';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/components/ui/empty';

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
            Start a song on the host, or queue one from the Library tab.
          </EmptyDescription>
        </EmptyHeader>
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
