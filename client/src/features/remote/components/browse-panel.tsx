import type { RemoteCommand, RemoteSnapshot } from '@/bridge/remote';
import { ImportSection } from '@/features/remote/components/import-section';
import { LibrarySection } from '@/features/remote/components/library-section';
import { LyricsSection } from '@/features/remote/components/lyrics-section';
import { QueueSection } from '@/features/remote/components/queue-section';
import { usePartyImportAllowed } from '@/features/remote/queries/use-party';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';

type BrowsePanelProps = {
  snapshot: RemoteSnapshot | null;
  locked: boolean;
  send: (command: RemoteCommand) => void;
};

/**
 * The surfaces that sit beside the controls: what the library holds, what the
 * room has lined up, the words of the song that is playing, and — when the
 * host allows it — a link to add to the library. They share one tab strip
 * because a guest is doing one thing, putting songs where they can be sung,
 * from every side of it.
 */
export const BrowsePanel = ({ snapshot, locked, send }: BrowsePanelProps) => {
  const canImport = usePartyImportAllowed();

  return (
    <Tabs className="h-full min-h-0 min-w-0" defaultValue="library">
      <TabsList className="h-12 w-full">
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
