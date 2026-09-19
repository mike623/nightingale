import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  connectRemote,
  type RemoteCommand,
  type RemoteConnectionState,
  type RemoteDeny,
  type RemoteLink,
  type RemoteSession,
  type RemoteSnapshot,
} from '@/bridge/remote';

/** How long a refusal stays on screen before the page stops mentioning it. */
const DENIAL_VISIBLE_MS = 4000;

export type RemoteClient = {
  snapshot: RemoteSnapshot | null;
  session: RemoteSession | null;
  isController: boolean;
  connection: RemoteConnectionState;
  /** Last refusal from the relay, cleared shortly after it arrives. */
  denial: RemoteDeny | null;
  send: (command: RemoteCommand) => void;
  claim: (force?: boolean) => void;
  release: () => void;
};

/**
 * Owns one participant socket for as long as the page is mounted. All state
 * here is published by the host: nothing is predicted locally, so a command
 * that the host ignores simply never shows up in a snapshot.
 */
export function useRemoteClient(): RemoteClient {
  const [snapshot, setSnapshot] = useState<RemoteSnapshot | null>(null);
  const [session, setSession] = useState<RemoteSession | null>(null);
  const [connection, setConnection] = useState<RemoteConnectionState>('connecting');
  const [denial, setDenial] = useState<RemoteDeny | null>(null);
  const linkRef = useRef<RemoteLink | null>(null);

  useEffect(() => {
    const link = connectRemote({
      onConnection: setConnection,
      onSession: setSession,
      onSnapshot: setSnapshot,
      onDeny: setDenial,
    });

    linkRef.current = link;

    return () => {
      linkRef.current = null;
      link.close();
    };
  }, []);

  useEffect(() => {
    if (denial === null) {
      return undefined;
    }

    const timer = setTimeout(() => setDenial(null), DENIAL_VISIBLE_MS);

    return () => clearTimeout(timer);
  }, [denial]);

  const send = useCallback((command: RemoteCommand) => {
    linkRef.current?.send(command);
  }, []);

  const claim = useCallback((force = false) => {
    linkRef.current?.claim(force);
  }, []);

  const release = useCallback(() => {
    linkRef.current?.release();
  }, []);

  const isController = session !== null && session.controller === session.you;

  return useMemo(
    () => ({ snapshot, session, isController, connection, denial, send, claim, release }),
    [snapshot, session, isController, connection, denial, send, claim, release],
  );
}
