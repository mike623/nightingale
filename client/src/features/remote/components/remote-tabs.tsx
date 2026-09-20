import type { RemoteCommand, RemoteSnapshot } from '@/bridge/remote';
import { LibrarySection } from '@/features/remote/components/library-section';
import { PlaybackPanel } from '@/features/remote/components/playback-panel';
import { QueueSection } from '@/features/remote/components/queue-section';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';

type RemoteTabsProps = {
  snapshot: RemoteSnapshot | null;
  positionMs: number;
  locked: boolean;
  send: (command: RemoteCommand) => void;
};

/**
 * The phone layout: one surface at a time, each with the whole screen.
 * A phone is too narrow to put the controls beside the list they feed, and
 * stacking them buries the library under a screenful of transport.
 *
 * It opens on the library, because a phone is picked up to add a song far
 * more often than to pause one.
 */
export const RemoteTabs = ({ snapshot, positionMs, locked, send }: RemoteTabsProps) => (
  <Tabs className="min-w-0 flex-1" defaultValue="library">
    {/* The page scrolls as one, so the switcher stays put rather than
        stranding a reader at the bottom of a long library. */}
    <TabsList className="sticky top-0 z-10 h-12 w-full">
      <TabsTrigger className="text-sm" value="playing">
        Playing
      </TabsTrigger>
      <TabsTrigger className="text-sm" value="library">
        Library
      </TabsTrigger>
      <TabsTrigger className="text-sm" value="queue">
        Queue
      </TabsTrigger>
    </TabsList>

    <TabsContent className="flex min-w-0 flex-col gap-4 text-sm" value="playing">
      <PlaybackPanel locked={locked} positionMs={positionMs} send={send} snapshot={snapshot} />
    </TabsContent>

    <TabsContent className="min-w-0 text-sm" value="library">
      <LibrarySection />
    </TabsContent>

    <TabsContent className="min-w-0 text-sm" value="queue">
      <QueueSection />
    </TabsContent>
  </Tabs>
);
