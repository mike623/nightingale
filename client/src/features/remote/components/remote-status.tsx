import type { RemoteConnectionState, RemoteDeny, RemoteSession } from '@/bridge/remote';
import { TOUCH_TARGET } from '@/features/remote/lib/touch-target';
import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/utils/cn';

const CONNECTION_COPY: Record<RemoteConnectionState, string> = {
  connecting: 'Connecting to the host',
  open: 'Connected',
  reconnecting: 'Connection lost. Retrying',
  unavailable: 'This host is not accepting remote connections',
};

const DENIAL_COPY: Record<RemoteDeny['reason'], string> = {
  'not-controller': 'Refused: another phone is in control',
  'no-host': 'Refused: no host is connected',
};

const controlCopy = (session: RemoteSession, isController: boolean): string => {
  if (!session.host_connected) {
    return 'No host is connected. Commands are refused until one joins';
  }

  if (isController) {
    return 'You are in control';
  }

  return session.controller === null ? 'Nobody is in control' : 'Another phone is in control';
};

type RemoteStatusProps = {
  connection: RemoteConnectionState;
  session: RemoteSession | null;
  isController: boolean;
  denial: RemoteDeny | null;
  onClaim: () => void;
  onRelease: () => void;
};

/**
 * The page's only account of whether a command can land: transport state, who
 * holds control, and the last refusal. It is text first, so none of that
 * depends on noticing a colour or a dimmed button.
 */
export const RemoteStatus = ({
  connection,
  session,
  isController,
  denial,
  onClaim,
  onRelease,
}: RemoteStatusProps) => {
  const connected = connection === 'open' && session !== null;
  const canClaim = connected && session.host_connected && !isController;

  return (
    <section
      aria-label="Connection"
      className="flex items-center justify-between gap-3 rounded-md border p-3"
    >
      <output aria-live="polite" className="block min-w-0">
        <span className="block text-sm font-medium">
          {connected ? controlCopy(session, isController) : CONNECTION_COPY[connection]}
        </span>
        {denial !== null && (
          <span className="block text-xs text-muted-foreground">{DENIAL_COPY[denial.reason]}</span>
        )}
      </output>

      {canClaim && (
        <Button className={cn(TOUCH_TARGET, 'shrink-0')} onClick={onClaim} type="button">
          Take control
        </Button>
      )}

      {isController && (
        <Button
          className={cn(TOUCH_TARGET, 'shrink-0')}
          onClick={onRelease}
          type="button"
          variant="outline"
        >
          Release
        </Button>
      )}
    </section>
  );
};
