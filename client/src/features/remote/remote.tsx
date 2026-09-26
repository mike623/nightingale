import { BrowsePanel } from '@/features/remote/components/browse-panel';
import { PlaybackPanel } from '@/features/remote/components/playback-panel';
import { RemoteStatus } from '@/features/remote/components/remote-status';
import { RemoteTabs } from '@/features/remote/components/remote-tabs';
import { useRemoteClient } from '@/features/remote/hooks/use-remote-client';
import { useRemotePosition } from '@/features/remote/hooks/use-remote-position';
import { useIsMobile } from '@/shared/hooks/use-is-mobile';

/**
 * Touch control surface for whatever the host is playing. Audio never leaves
 * the host: this page sends commands and renders the snapshot it is given, so
 * it stays honest about state it cannot observe.
 *
 * Several devices can be on this page at once and all of them may act. Only
 * the playback controls need a host to talk to; the library and the queue do
 * not, so the room can line songs up before anything is playing.
 *
 * A phone shows one surface at a time. From tablet width there is room for
 * the controls to sit beside the list they feed, so they do.
 *
 * The page spans the whole viewport at every width: a tablet held in landscape
 * is all remote and nothing else, so capping the line length would only shrink
 * the library it exists to browse.
 */
export const RemotePage = () => {
  const { snapshot, session, connection, denial, send } = useRemoteClient();
  const positionMs = useRemotePosition(snapshot);
  const isMobile = useIsMobile();

  const hostConnected = session?.host_connected ?? false;
  const locked = !hostConnected || connection !== 'open';

  return (
    <div className="h-svh overflow-y-auto overscroll-contain md:overflow-hidden">
      <main className="flex h-full w-full min-w-0 flex-col gap-4 pt-[max(1rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]">
        <RemoteStatus connection={connection} denial={denial} session={session} />

        {isMobile ? (
          <RemoteTabs locked={locked} positionMs={positionMs} send={send} snapshot={snapshot} />
        ) : (
          <div className="grid min-h-0 min-w-0 flex-1 gap-4 md:grid-cols-4">
            <section
              aria-label="Controls"
              className="flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto pr-2"
            >
              <PlaybackPanel
                locked={locked}
                positionMs={positionMs}
                send={send}
                snapshot={snapshot}
              />
            </section>

            <div className="min-h-0 min-w-0 overflow-y-auto md:col-span-3">
              <BrowsePanel />
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
