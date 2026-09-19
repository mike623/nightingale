import { GuideSection } from '@/features/remote/components/guide-section';
import { NowPlaying } from '@/features/remote/components/now-playing';
import { OptionsSection } from '@/features/remote/components/options-section';
import { RemoteStatus } from '@/features/remote/components/remote-status';
import { TransportSection } from '@/features/remote/components/transport-section';
import { useRemoteClient } from '@/features/remote/hooks/use-remote-client';
import { useRemotePosition } from '@/features/remote/hooks/use-remote-position';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/components/ui/empty';

/**
 * Phone-sized control surface for whatever the host is playing. Audio never
 * leaves the host: this page sends commands and renders the snapshot it is
 * given, so it stays honest about state it cannot observe.
 */
export const RemotePage = () => {
  const { snapshot, session, isController, connection, denial, send, claim, release } =
    useRemoteClient();
  const positionMs = useRemotePosition(snapshot);

  const hostConnected = session?.host_connected ?? false;
  const locked = !isController || !hostConnected || connection !== 'open';

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col gap-4 pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]">
      <RemoteStatus
        connection={connection}
        denial={denial}
        isController={isController}
        onClaim={() => claim(true)}
        onRelease={release}
        session={session}
      />

      {snapshot === null ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Nothing is playing</EmptyTitle>
            <EmptyDescription>Start a song on the host to control it from here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <NowPlaying snapshot={snapshot} />
          <TransportSection
            disabled={locked}
            positionMs={positionMs}
            send={send}
            snapshot={snapshot}
          />
          <GuideSection disabled={locked} send={send} snapshot={snapshot} />
          <OptionsSection disabled={locked} send={send} snapshot={snapshot} />
        </>
      )}
    </main>
  );
};
