import {
  remoteCommandSchema,
  remoteDenySchema,
  remoteEnvelopeSchema,
  remoteSessionSchema,
  remoteStateSchema,
  type RemoteCommand,
  type RemoteDeny,
  type RemoteSession,
  type RemoteSnapshot,
} from './remote-schemas';
import { tauriRemoteAdapter } from './remote.tauri';
import { webRemoteAdapter } from './remote.web';
import { isTauri } from './runtime';

export type {
  RemoteCommand,
  RemoteDeny,
  RemoteSession,
  RemoteSnapshot,
  RemoteSong,
} from './remote-schemas';

/**
 * The only part of remote control that differs between delivery targets:
 * the self-hosted server merges the relay into the origin the page came from,
 * while the desktop build starts a listener of its own and reports the
 * address it bound to. Everything above this boundary is target-agnostic.
 */
export type RemoteEndpointAdapter = {
  /** WebSocket this device uses to reach the relay. */
  socketUrl(): Promise<string>;
  /** Address a phone can open, or `null` when the host has none to share. */
  shareUrl(): Promise<string | null>;
  stopHost(): Promise<void>;
};

const remoteEndpointAdapter: RemoteEndpointAdapter = isTauri
  ? tauriRemoteAdapter
  : webRemoteAdapter;

export const resolveRemoteShareUrl = (): Promise<string | null> => remoteEndpointAdapter.shareUrl();

/** Stops the desktop listener. A no-op on the self-hosted target. */
export const stopRemoteHost = (): Promise<void> => remoteEndpointAdapter.stopHost();

/**
 * `unavailable` means the endpoint itself could not be resolved — the desktop
 * listener refused to start, or the server answered nothing usable. It is
 * still retried, but it is a different thing to tell the user than a socket
 * that merely dropped.
 */
export type RemoteConnectionState = 'connecting' | 'open' | 'reconnecting' | 'unavailable';

export type RemoteHandlers = {
  onConnection(state: RemoteConnectionState): void;
  onSession(session: RemoteSession): void;
  onSnapshot(snapshot: RemoteSnapshot | null): void;
  onDeny(deny: RemoteDeny): void;
  /** Host role only: a command relayed from the phone in control. */
  onCommand?(command: RemoteCommand): void;
};

/**
 * Which end of the relay this socket is. The host publishes snapshots and
 * answers commands; a remote sends commands and renders what it is told.
 */
export type RemoteRole = 'host' | 'remote';

export type RemoteLink = {
  send(command: RemoteCommand): void;
  /** Host role only: publishes the current playback state to every phone. */
  publish(snapshot: RemoteSnapshot): void;
  claim(force: boolean): void;
  release(): void;
  close(): void;
};

const FIRST_RETRY_MS = 500;
const MAX_RETRY_MS = 10_000;

/**
 * A relayed frame is written by another client, so its size is bounded before
 * it is even handed to the parser. Snapshots are a few hundred bytes.
 */
const MAX_FRAME_CHARS = 64 * 1024;

const routeFrame = (type: string, payload: unknown, handlers: RemoteHandlers): void => {
  if (type === 'remote.session') {
    const parsed = remoteSessionSchema.safeParse(payload);

    if (parsed.success) {
      handlers.onSession(parsed.data);
    }

    return;
  }

  if (type === 'remote.state') {
    const parsed = remoteStateSchema.safeParse(payload);

    if (parsed.success) {
      handlers.onSnapshot(parsed.data);
    }

    return;
  }

  if (type === 'remote.deny') {
    const parsed = remoteDenySchema.safeParse(payload);

    if (parsed.success) {
      handlers.onDeny(parsed.data);
    }

    return;
  }

  if (type === 'remote.command' && handlers.onCommand !== undefined) {
    const parsed = remoteCommandSchema.safeParse(payload);

    if (parsed.success) {
      handlers.onCommand(parsed.data);
    }
  }

  // A command reaching a remote is addressed to the host, and unknown types
  // belong to a protocol this build does not speak. Both are dropped.
};

const receiveFrame = (data: unknown, handlers: RemoteHandlers): void => {
  if (typeof data !== 'string' || data.length > MAX_FRAME_CHARS) {
    return;
  }

  let decoded: unknown;

  try {
    decoded = JSON.parse(data);
  } catch {
    return;
  }

  const envelope = remoteEnvelopeSchema.safeParse(decoded);

  if (!envelope.success) {
    return;
  }

  routeFrame(envelope.data.type, envelope.data.payload, handlers);
};

/**
 * Opens a participant socket to the relay and keeps it open: it announces the
 * role on connect, validates everything that comes back, and reconnects with
 * exponential backoff when the host or the network goes away. Each caller owns
 * its own socket; the `/ws` multiplexer in `runtime.ts` carries application
 * events and is deliberately not shared with this traffic.
 */
export const connectRemote = (
  handlers: RemoteHandlers,
  role: RemoteRole = 'remote',
): RemoteLink => {
  let socket: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let disposed = false;

  const post = (frame: Record<string, unknown>): void => {
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify(frame));
  };

  const retry = (): void => {
    if (disposed || retryTimer !== null) {
      return;
    }

    const delay = Math.min(FIRST_RETRY_MS * 2 ** attempt, MAX_RETRY_MS);

    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void open();
    }, delay);
  };

  const attach = (next: WebSocket): void => {
    socket = next;

    next.addEventListener('open', () => {
      attempt = 0;
      handlers.onConnection('open');
      post({ type: 'remote.hello', role });
    });

    next.addEventListener('message', (event: MessageEvent<unknown>) => {
      receiveFrame(event.data, handlers);
    });

    next.addEventListener('close', () => {
      if (socket === next) {
        socket = null;
      }

      if (!disposed) {
        handlers.onConnection('reconnecting');
        retry();
      }
    });
  };

  const open = async (): Promise<void> => {
    if (attempt === 0) {
      handlers.onConnection('connecting');
    }

    try {
      const url = await remoteEndpointAdapter.socketUrl();

      if (disposed) {
        return;
      }

      attach(new WebSocket(url));
    } catch {
      handlers.onConnection('unavailable');
      retry();
    }
  };

  void open();

  return {
    send: (command) => post({ type: 'remote.command', ...command }),
    publish: (snapshot) => post({ type: 'remote.state', ...snapshot }),
    claim: (force) => post({ type: 'remote.claim', force }),
    release: () => post({ type: 'remote.release' }),
    close: () => {
      disposed = true;

      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }

      socket?.close();
      socket = null;
    },
  };
};
