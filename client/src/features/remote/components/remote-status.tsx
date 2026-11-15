import type { RemoteConnectionState } from '@/features/remote/lib/remote-model';
import { t, type TranslationKey } from '@/i18n';

const CONNECTION_COPY: Record<RemoteConnectionState, TranslationKey> = {
  connecting: 'remote.status.connecting',
  open: 'remote.status.connected',
  unavailable: 'remote.status.unavailable',
};

type RemoteStatusProps = {
  connection: RemoteConnectionState;
  /** The host has a song up, so playback controls can land. */
  hostActive: boolean;
  denial: string | null;
};

const statusCopy = (connection: RemoteConnectionState, hostActive: boolean): string => {
  if (connection !== 'open') {
    return t(CONNECTION_COPY[connection]);
  }
  return hostActive ? t('remote.status.anyoneCanControl') : t('remote.status.nothingPlaying');
};

/**
 * The page's only account of whether a playback command can land: transport
 * state and the last refusal. Text first, so neither depends on noticing a
 * colour or a dimmed button.
 */
export const RemoteStatus = ({ connection, hostActive, denial }: RemoteStatusProps) => (
  <output aria-live="polite" className="block min-w-0 rounded-md border p-3">
    <span className="block text-sm font-medium">{statusCopy(connection, hostActive)}</span>
    {denial !== null && (
      <span className="block text-xs text-muted-foreground">
        {t('remote.status.refused', { reason: denial })}
      </span>
    )}
  </output>
);
