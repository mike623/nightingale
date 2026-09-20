import { BrowsePanel } from '@/features/remote/components/browse-panel';
import { PlaybackPanel } from '@/features/remote/components/playback-panel';
import { RemoteStatus } from '@/features/remote/components/remote-status';
import { useRemoteClient } from '@/features/remote/hooks/use-remote-client';
import { useRemotePosition } from '@/features/remote/hooks/use-remote-position';

/**
 * Touch control surface for whatever the host is playing. Audio never leaves
 * the host: this page sends commands and renders the snapshot it is given, so
 * it stays honest about state it cannot observe.
 *
 * Several devices can be on this page at once and all of them may act. Only
 * the playback controls need a host to talk to; the library and the queue do
 * not, so the room can line songs up before anything is playing.
 *
 * A phone stacks the two panels and scrolls the page. From tablet width the
 * controls keep a quarter of the width beside the list they feed, and each
 * side scrolls on its own.
 */
export const RemotePage = () => {
  const { snapshot, session, connection, denial, send } = useRemoteClient();
  const positionMs = useRemotePosition(snapshot);

  const hostConnected = session?.host_connected ?? false;
  const locked = !hostConnected || connection !== 'open';

  return (
    <div className="h-svh overflow-y-auto overscroll-contain md:overflow-hidden">
      <main className="mx-auto flex min-h-full w-full max-w-md flex-col gap-4 pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] md:h-full md:max-w-5xl">
        <RemoteStatus connection={connection} denial={denial} session={session} />

        <div className="grid gap-4 md:min-h-0 md:flex-1 md:grid-cols-4">
          <section
            aria-label="Controls"
            className="flex flex-col gap-4 md:min-h-0 md:overflow-y-auto md:pr-2"
          >
            <PlaybackPanel
              locked={locked}
              positionMs={positionMs}
              send={send}
              snapshot={snapshot}
            />
          </section>

          <div className="md:col-span-3 md:min-h-0 md:overflow-y-auto">
            <BrowsePanel />
          </div>
        </div>
      </main>
    </div>
  );
};
