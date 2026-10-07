import type { RemoteConnectionState, RemoteDeny, RemoteSession } from '@/bridge/remote';

const CONNECTION_COPY: Record<RemoteConnectionState, string> = {
  connecting: 'Connecting to the host',
  open: 'Connected',
  reconnecting: 'Connection lost. Retrying',
  unavailable: 'This host is not accepting remote connections',
};

const DENIAL_COPY: Record<RemoteDeny['reason'], string> = {
  'no-host': 'Refused: no host is connected',
};

type RemoteStatusProps = {
  connection: RemoteConnectionState;
  session: RemoteSession | null;
  denial: RemoteDeny | null;
};

/**
 * The page's only account of whether a playback command can land: transport
 * state and the last refusal. It is text first, so neither depends on
 * noticing a colour or a dimmed button.
 */
const statusCopy = (connection: RemoteConnectionState, session: RemoteSession | null): string => {
  if (connection !== 'open' || session === null) {
    return CONNECTION_COPY[connection];
  }

  return session.host_connected
    ? 'Connected. Anyone here can control playback'
    : 'Nothing is playing. You can still queue songs';
};

export const RemoteStatus = ({ connection, session, denial }: RemoteStatusProps) => {
  const copy = statusCopy(connection, session);

  return (
    <output aria-live="polite" className="block min-w-0 rounded-md border p-3">
      <span className="block text-sm font-medium">{copy}</span>
      {denial !== null && (
        <span className="block text-xs text-muted-foreground">{DENIAL_COPY[denial.reason]}</span>
      )}
    </output>
  );
};
