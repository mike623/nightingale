import type { ReactNode } from 'react';

import type { RemoteCommand, RemoteSnapshot } from '@/bridge/remote';
import { TOUCH_TARGET } from '@/features/remote/lib/touch-target';
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

/** The host names the device it captures from; it may report no name at all. */
const micValue = (snapshot: RemoteSnapshot): string => {
  if (!snapshot.mic_enabled) {
    return 'Off';
  }

  const name = snapshot.mic_name ?? '';

  return name.length > 0 ? name : 'On';
};

const MicrophoneRow = ({ snapshot, disabled, send }: RowProps) => {
  const enabled = snapshot.mic_enabled;

  return (
    <OptionRow label="Microphone" value={micValue(snapshot)}>
      <Button
        aria-label="Switch microphone"
        className={TOUCH_TARGET}
        disabled={disabled}
        onClick={() => send({ action: 'cycle_mic' })}
        type="button"
        variant="outline"
      >
        Switch
      </Button>
      <Button
        aria-label={enabled ? 'Turn microphone off' : 'Turn microphone on'}
        className={TOUCH_TARGET}
        disabled={disabled}
        onClick={() => send({ action: 'toggle_mic' })}
        type="button"
        variant="outline"
      >
        {enabled ? 'Off' : 'On'}
      </Button>
    </OptionRow>
  );
};

const MonitorRow = ({ snapshot, disabled, send }: RowProps) => {
  const enabled = snapshot.mic_monitor_enabled;

  return (
    <OptionRow label="Mic monitor" value={enabled ? 'On' : 'Off'}>
      <Button
        aria-label={enabled ? 'Turn mic monitor off' : 'Turn mic monitor on'}
        className={TOUCH_TARGET}
        disabled={disabled}
        onClick={() => send({ action: 'toggle_mic_monitor' })}
        type="button"
        variant="outline"
      >
        {enabled ? 'Off' : 'On'}
      </Button>
    </OptionRow>
  );
};

const SkipRow = ({ snapshot, disabled, send }: RowProps) => (
  <OptionRow label="Skip" value="Available while the intro or outro plays">
    <Button
      className={TOUCH_TARGET}
      disabled={disabled || !snapshot.can_skip_intro}
      onClick={() => send({ action: 'skip_intro' })}
      type="button"
      variant="outline"
    >
      Intro
    </Button>
    <Button
      className={TOUCH_TARGET}
      disabled={disabled || !snapshot.can_skip_outro}
      onClick={() => send({ action: 'skip_outro' })}
      type="button"
      variant="outline"
    >
      Outro
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
    <h2 className="text-sm font-medium">Options</h2>

    <OptionRow label="Lyrics" value={snapshot.lyrics_hidden ? 'Hidden' : 'Visible'}>
      <Button
        aria-label={snapshot.lyrics_hidden ? 'Show lyrics' : 'Hide lyrics'}
        className={TOUCH_TARGET}
        disabled={disabled}
        onClick={() => send({ action: 'toggle_lyrics' })}
        type="button"
        variant="outline"
      >
        {snapshot.lyrics_hidden ? 'Show' : 'Hide'}
      </Button>
    </OptionRow>

    <Separator />

    <OptionRow label="Background" value={snapshot.theme_name}>
      <Button
        aria-label="Next background"
        className={TOUCH_TARGET}
        disabled={disabled}
        onClick={() => send({ action: 'cycle_theme' })}
        type="button"
        variant="outline"
      >
        Next
      </Button>
    </OptionRow>

    <Separator />

    <OptionRow label="Video" value={snapshot.flavor_name}>
      <Button
        aria-label="Next video style"
        className={TOUCH_TARGET}
        disabled={disabled}
        onClick={() => send({ action: 'cycle_flavor' })}
        type="button"
        variant="outline"
      >
        Next
      </Button>
    </OptionRow>

    <Separator />

    <MicrophoneRow disabled={disabled} send={send} snapshot={snapshot} />

    <Separator />

    <MonitorRow disabled={disabled} send={send} snapshot={snapshot} />

    <Separator />

    <SkipRow disabled={disabled} send={send} snapshot={snapshot} />
  </section>
);
