import { QRCodeSVG } from 'qrcode.react';

import { useRemoteShareUrl } from '@/features/remote/queries/use-remote-share-url';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/components/ui/empty';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { cn } from '@/shared/utils/cn';

const QR_PIXELS = 192;

/**
 * Scan target for joining the remote. The code is rendered on a fixed light
 * background so camera contrast does not depend on the app theme, and the
 * address is repeated as selectable text for anyone typing it in by hand.
 */
export const RemoteQr = ({ className }: { className?: string }) => {
  const { data, isLoading, isError } = useRemoteShareUrl();
  const lanUrl = data ?? null;

  if (isLoading) {
    return <Skeleton className={cn('size-48 rounded-md', className)} />;
  }

  if (isError) {
    return (
      <Empty className={className}>
        <EmptyHeader>
          <EmptyTitle>Remote control unavailable</EmptyTitle>
          <EmptyDescription>This host could not start remote control.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (lanUrl === null || lanUrl.length === 0) {
    return (
      <Empty className={className}>
        <EmptyHeader>
          <EmptyTitle>No address to share</EmptyTitle>
          <EmptyDescription>
            This host has no network address phones can reach. Bind it to the local network to use
            the remote.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className={cn('flex flex-col items-center gap-3', className)}>
      <div className="rounded-md bg-white p-3">
        <QRCodeSVG
          value={lanUrl}
          size={QR_PIXELS}
          level="M"
          marginSize={4}
          bgColor="#ffffff"
          fgColor="#000000"
          title={`Remote control address: ${lanUrl}`}
        />
      </div>
      <span className="font-mono text-xs break-all select-all">{lanUrl}</span>
    </div>
  );
};
