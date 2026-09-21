import { ImportSection } from '@/features/remote/components/import-section';
import { LibrarySection } from '@/features/remote/components/library-section';
import { QueueSection } from '@/features/remote/components/queue-section';
import { usePartyImportAllowed } from '@/features/remote/queries/use-party';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';

/**
 * The surfaces that do not need a host: what the library holds, what the room
 * has lined up, and — when the host allows it — a link to add to the library.
 * They share one tab strip because a guest is doing one thing, putting songs
 * where they can be sung, from every side of it.
 */
export const BrowsePanel = () => {
  const canImport = usePartyImportAllowed();

  return (
    <Tabs className="h-full min-w-0" defaultValue="library">
      <TabsList className="h-12 w-full">
        <TabsTrigger className="text-sm" value="library">
          Library
        </TabsTrigger>
        <TabsTrigger className="text-sm" value="queue">
          Queue
        </TabsTrigger>
        {canImport && (
          <TabsTrigger className="text-sm" value="import">
            Add
          </TabsTrigger>
        )}
      </TabsList>

      <TabsContent className="min-w-0 text-sm" value="library">
        <LibrarySection />
      </TabsContent>

      <TabsContent className="min-w-0 text-sm" value="queue">
        <QueueSection />
      </TabsContent>

      {canImport && (
        <TabsContent className="min-w-0 text-sm" value="import">
          <ImportSection />
        </TabsContent>
      )}
    </Tabs>
  );
};
