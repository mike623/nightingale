import type { RemoteCommand, RemoteSnapshot } from '@/bridge/remote';
import { ImportSection } from '@/features/remote/components/import-section';
import { LibrarySection } from '@/features/remote/components/library-section';
import { LyricsSection } from '@/features/remote/components/lyrics-section';
import { PlaybackPanel } from '@/features/remote/components/playback-panel';
import { QueueSection } from '@/features/remote/components/queue-section';
import { usePartyImportAllowed } from '@/features/remote/queries/use-party';
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
export const RemoteTabs = ({ snapshot, positionMs, locked, send }: RemoteTabsProps) => {
  const canImport = usePartyImportAllowed();

  return (
    <Tabs className="min-h-0 min-w-0 flex-1" defaultValue="library">
      {/* The library owns its own scroll, but the other surfaces run off the
          bottom of a phone, so the switcher stays put rather than stranding a
          reader at the end of one. */}
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
        <TabsTrigger className="text-sm" value="lyrics">
          Lyrics
        </TabsTrigger>
        {canImport && (
          <TabsTrigger className="text-sm" value="import">
            Add
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent className="flex min-w-0 flex-col gap-4 text-sm" value="playing">
        <PlaybackPanel locked={locked} positionMs={positionMs} send={send} snapshot={snapshot} />
      </TabsContent>

      <TabsContent className="min-h-0 min-w-0 text-sm" value="library">
        <LibrarySection />
      </TabsContent>

      <TabsContent className="min-w-0 text-sm" value="queue">
        <QueueSection />
      </TabsContent>

      <TabsContent className="min-w-0 text-sm" value="lyrics">
        <LyricsSection locked={locked} send={send} snapshot={snapshot} />
      </TabsContent>

      {canImport && (
        <TabsContent className="min-w-0 text-sm" value="import">
          <ImportSection />
        </TabsContent>
      )}
    </Tabs>
  );
};
