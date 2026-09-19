import { useQuery } from '@tanstack/react-query';

import { resolveRemoteShareUrl } from '@/bridge/remote';

const REMOTE_SHARE_URL = ['remote-share-url'];

/**
 * Address phones open to join the remote, or `null` when this host has none.
 * Reading it starts the desktop listener, so it is fetched once and kept for
 * the life of the app rather than refetched on focus.
 */
export const useRemoteShareUrl = () =>
  useQuery({
    queryKey: REMOTE_SHARE_URL,
    queryFn: resolveRemoteShareUrl,
    staleTime: Infinity,
  });
