import { useQuery, useQueryClient } from '@tanstack/react-query';

import { resolveRemoteShareUrl, stopRemoteHost } from '@/bridge/remote';

const REMOTE_SHARE_URL = ['remote-share-url'];

/**
 * Address phones open to join the remote, or `null` when this host has none.
 *
 * Re-read whenever the panel showing it is opened or the window is focused.
 * The address is the machine's current LAN address, which a new DHCP lease can
 * change underneath a running app — a cached one would keep pointing the phone
 * at whatever device holds that address now. Resolving it starts the desktop
 * listener, which is idempotent: an already-running listener reports its port.
 */
export const useRemoteShareUrl = () =>
  useQuery({
    queryKey: REMOTE_SHARE_URL,
    queryFn: resolveRemoteShareUrl,
    refetchOnMount: 'always',
  });

/**
 * Release the desktop listener and forget its address, for when the operator
 * turns remote control off. The port stays bound to the local network until
 * this runs, so the switch is only honest if it does.
 */
export const useReleaseRemoteHost = () => {
  const queryClient = useQueryClient();

  return async (): Promise<void> => {
    await stopRemoteHost();
    queryClient.removeQueries({ queryKey: REMOTE_SHARE_URL });
  };
};
