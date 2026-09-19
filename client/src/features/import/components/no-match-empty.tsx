import { Empty, EmptyHeader, EmptyTitle } from '@/shared/components/ui/empty';

export const NoMatchEmpty = () => (
  <Empty>
    <EmptyHeader>
      <EmptyTitle>No tracks match your search</EmptyTitle>
    </EmptyHeader>
  </Empty>
);
