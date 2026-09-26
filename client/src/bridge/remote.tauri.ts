import type { RemoteStatus } from '@/types/RemoteStatus';

import type { RemoteEndpointAdapter } from './remote';
import { remoteStatusSchema } from './remote-schemas';
import { invoke } from './runtime';

const readStatus = async (): Promise<RemoteStatus> => {
  const raw: unknown = await invoke('remote_status');

  return remoteStatusSchema.parse(raw);
};

/**
 * The desktop listener is opt-in and off until something asks for it, so the
 * first resolve starts it and re-reads the address it bound to instead of
 * trusting whatever `remote_start` echoes back.
 */
const runningStatus = async (): Promise<RemoteStatus> => {
  const status = await readStatus();

  if (status.running) {
    return status;
  }

  await invoke('remote_start');

  return await readStatus();
};

export const tauriRemoteAdapter: RemoteEndpointAdapter = {
  socketUrl: async (): Promise<string> => {
    const status = await runningStatus();

    if (status.ws_url === null) {
      throw new Error('Remote control is running without a WebSocket address');
    }

    return status.ws_url;
  },

  shareUrl: async (): Promise<string | null> => (await runningStatus()).lan_url,

  stopHost: async (): Promise<void> => {
    await invoke('remote_stop');
  },
};
