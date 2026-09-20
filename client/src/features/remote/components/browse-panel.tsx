import { LibrarySection } from '@/features/remote/components/library-section';
import { QueueSection } from '@/features/remote/components/queue-section';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';

/**
 * The two surfaces that do not need a host: what the library holds and what
 * the room has lined up. They share one tab strip because a guest is doing
 * one thing — putting songs in the queue — from either side of it.
 */
export const BrowsePanel = () => (
  <Tabs className="h-full min-w-0" defaultValue="library">
    <TabsList className="h-12 w-full">
      <TabsTrigger className="text-sm" value="library">
        Library
      </TabsTrigger>
      <TabsTrigger className="text-sm" value="queue">
        Queue
      </TabsTrigger>
    </TabsList>

    <TabsContent className="min-w-0 text-sm" value="library">
      <LibrarySection />
    </TabsContent>

    <TabsContent className="min-w-0 text-sm" value="queue">
      <QueueSection />
    </TabsContent>
  </Tabs>
);
