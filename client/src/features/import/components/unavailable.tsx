import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/components/ui/empty';

export const ImportUnavailable = () => (
  <Empty>
    <EmptyHeader>
      <EmptyTitle>Import needs a folder library</EmptyTitle>
      <EmptyDescription>
        Imported files are written into the watched folder, so Import is only available when your
        library is a folder — not a Plex, Jellyfin, or Navidrome server.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);
