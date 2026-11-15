import type { ReactNode } from 'react';

import type { RemoteCommand, RemoteSnapshot } from '@/features/remote/lib/remote-model';
import { TOUCH_TARGET } from '@/features/remote/lib/touch-target';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { Separator } from '@/shared/components/ui/separator';

type OptionRowProps = {
  label: string;
  value: string;
  children: ReactNode;
};

const OptionRow = ({ label, value, children }: OptionRowProps) => (
  <div className="flex items-center justify-between gap-3">
    <div className="min-w-0">
      <p className="text-sm font-medium">{label}</p>
      <p className="truncate text-xs text-muted-foreground">{value}</p>
    </div>
    <div className="flex shrink-0 gap-2">{children}</div>
  </div>
);

type RowProps = {
  snapshot: RemoteSnapshot;
  disabled: boolean;
  send: (command: RemoteCommand) => void;
};

const onOff = (enabled: boolean): string =>
  enabled ? t('common.states.on') : t('common.states.off');

/** The host names the device it captures from; it may report no name at all. */
const micValue = (snapshot: RemoteSnapshot): string => {
  if (!snapshot.mic_enabled) {
    return t('common.states.off');
  }
  const name = snapshot.mic_name ?? '';
  return name.length > 0 ? name : t('common.states.on');
};

const MicrophoneRows = ({ snapshot, disabled, send }: RowProps) => (
  <>
    <Separator />
    <OptionRow label={t('remote.playing.microphone')} value={micValue(snapshot)}>
      <Button
        aria-label={t('remote.playing.switchMicrophone')}
        className={TOUCH_TARGET}
        disabled={disabled}
        onClick={() => send({ action: 'cycle_mic' })}
        type="button"
        variant="outline"
      >
        {t('remote.playing.switch')}
      </Button>
      <Button
        aria-label={snapshot.mic_enabled ? t('remote.playing.micOff') : t('remote.playing.micOn')}
        className={TOUCH_TARGET}
        disabled={disabled}
        onClick={() => send({ action: 'toggle_mic' })}
        type="button"
        variant="outline"
      >
        {onOff(!snapshot.mic_enabled)}
      </Button>
    </OptionRow>
    <Separator />
    <OptionRow label={t('remote.queue.monitoring')} value={onOff(snapshot.mic_monitor_enabled)}>
      <Button
        aria-label={
          snapshot.mic_monitor_enabled
            ? t('remote.playing.monitorOff')
            : t('remote.playing.monitorOn')
        }
        className={TOUCH_TARGET}
        disabled={disabled}
        onClick={() => send({ action: 'toggle_mic_monitor' })}
        type="button"
        variant="outline"
      >
        {onOff(!snapshot.mic_monitor_enabled)}
      </Button>
    </OptionRow>
  </>
);

const VideoRow = ({ snapshot, disabled, send }: RowProps) => (
  <>
    <Separator />
    <OptionRow label={t('remote.playing.video')} value={snapshot.flavor_name}>
      <Button
        aria-label={t('remote.playing.nextVideoStyle')}
        className={TOUCH_TARGET}
        disabled={disabled}
        onClick={() => send({ action: 'cycle_flavor' })}
        type="button"
        variant="outline"
      >
        {t('remote.playing.next')}
      </Button>
    </OptionRow>
  </>
);

const SkipRow = ({ snapshot, disabled, send }: RowProps) => (
  <OptionRow label={t('remote.playing.skip')} value={t('remote.playing.skipHint')}>
    <Button
      className={TOUCH_TARGET}
      disabled={disabled || !snapshot.can_skip_intro}
      onClick={() => send({ action: 'skip_intro' })}
      type="button"
      variant="outline"
    >
      {t('remote.playing.intro')}
    </Button>
    <Button
      className={TOUCH_TARGET}
      disabled={disabled || !snapshot.can_skip_outro}
      onClick={() => send({ action: 'skip_outro' })}
      type="button"
      variant="outline"
    >
      {t('remote.playing.outro')}
    </Button>
  </OptionRow>
);

/**
 * Playback options the host exposes. Each row states what the host currently
 * reports and offers the action that changes it; nothing is inferred from a
 * command this page sent.
 */
export const OptionsSection = ({ snapshot, disabled, send }: RowProps) => (
  <section className="space-y-3">
    <h2 className="text-sm font-medium">{t('remote.playing.options')}</h2>
    <OptionRow
      label={t('remote.tabs.lyrics')}
      value={snapshot.lyrics_hidden ? t('remote.playing.hidden') : t('remote.playing.visible')}
    >
      <Button
        aria-label={
          snapshot.lyrics_hidden ? t('remote.lyrics.showOnScreen') : t('remote.lyrics.hideOnScreen')
        }
        className={TOUCH_TARGET}
        disabled={disabled}
        onClick={() => send({ action: 'toggle_lyrics' })}
        type="button"
        variant="outline"
      >
        {snapshot.lyrics_hidden ? t('remote.playing.show') : t('remote.playing.hide')}
      </Button>
    </OptionRow>
    <Separator />
    <OptionRow label={t('remote.playing.background')} value={snapshot.theme_name}>
      <Button
        aria-label={t('remote.playing.nextBackground')}
        className={TOUCH_TARGET}
        disabled={disabled}
        onClick={() => send({ action: 'cycle_theme' })}
        type="button"
        variant="outline"
      >
        {t('remote.playing.next')}
      </Button>
    </OptionRow>
    {snapshot.flavor_available && <VideoRow disabled={disabled} send={send} snapshot={snapshot} />}
    {/* Each multiplayer singer owns a microphone, so the single-mic rows do not apply. */}
    {!snapshot.multiplayer && (
      <MicrophoneRows disabled={disabled} send={send} snapshot={snapshot} />
    )}
    <Separator />
    <SkipRow disabled={disabled} send={send} snapshot={snapshot} />
  </section>
);
