import { z } from 'zod';

import type { RemoteEndpointAdapter } from './remote';

/**
 * The self-hosted server merges the relay into the `/ws` route it already
 * serves, so the browser reaches it on the origin it was loaded from.
 */
const wsUrl = (): string => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  return `${proto}//${window.location.host}/ws`;
};

/**
 * Only the field this module needs. `/api/bootstrap` is parsed in full by
 * `main.tsx`; the address printed on the QR is read separately here so the
 * remote feature owns its own contract with the payload. Operators running
 * behind a proxy or on loopback only may have no shareable address at all,
 * which arrives as a missing or null `remoteUrl`.
 */
const bootstrapRemoteSchema = z.object({ remoteUrl: z.string().nullish() });

const readLanUrl = async (): Promise<string | null> => {
  const res = await fetch('/api/bootstrap');

  if (!res.ok) {
    return null;
  }

  const body: unknown = await res.json();
  const parsed = bootstrapRemoteSchema.safeParse(body);

  if (!parsed.success) {
    return null;
  }

  return parsed.data.remoteUrl ?? null;
};

let pendingLanUrl: Promise<string | null> | null = null;

const lanUrl = (): Promise<string | null> => {
  pendingLanUrl ??= readLanUrl().catch(() => null);

  return pendingLanUrl;
};

export const webRemoteAdapter: RemoteEndpointAdapter = {
  socketUrl: (): Promise<string> => Promise.resolve(wsUrl()),

  shareUrl: lanUrl,

  // The operator owns the server's lifetime; a browser tab cannot stop it.
  stopHost: (): Promise<void> => Promise.resolve(),
};
