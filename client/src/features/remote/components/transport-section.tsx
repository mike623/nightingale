import { LogOutIcon, PauseIcon, PlayIcon, RotateCcwIcon, SkipForwardIcon } from 'lucide-react';
import { useState } from 'react';

import type { RemoteCommand, RemoteSnapshot } from '@/bridge/remote';
import { TOUCH_TARGET } from '@/features/remote/lib/touch-target';
import { Button } from '@/shared/components/ui/button';
import { Slider } from '@/shared/components/ui/slider';
import { cn } from '@/shared/utils/cn';
import { formatSeconds } from '@/shared/utils/format-duration';

const SEEK_STEP_MS = 1000;

type TransportSectionProps = {
  snapshot: RemoteSnapshot;
  positionMs: number;
  disabled: boolean;
  send: (command: RemoteCommand) => void;
};

/**
 * Transport for the song the host is already playing. The seek slider follows
 * the host until a drag starts, holds the dragged value while the finger is
 * down, and hands authority straight back once the seek is sent.
 */
export const TransportSection = ({
  snapshot,
  positionMs,
  disabled,
  send,
}: TransportSectionProps) => {
  const [scrubMs, setScrubMs] = useState<number | null>(null);

  const durationMs = snapshot.duration_ms;
  const seekable = durationMs > 0;
  const shownMs = scrubMs ?? positionMs;

  return (
    <section aria-label="Playback" className="space-y-3">
      <fieldset className="space-y-2">
        <legend className="sr-only">Seek</legend>

        <Slider
          disabled={disabled || !seekable}
          max={Math.max(durationMs, 1)}
          min={0}
          onValueChange={([value]) => setScrubMs(value)}
          onValueCommit={([value]) => {
            send({ action: 'seek', position_ms: Math.round(value) });
            setScrubMs(null);
          }}
          step={SEEK_STEP_MS}
          value={[Math.min(shownMs, durationMs)]}
        />

        <p className="flex justify-between text-xs tabular-nums text-muted-foreground">
          <span>{formatSeconds(shownMs / 1000)}</span>
          <span>{formatSeconds(durationMs / 1000)}</span>
        </p>
      </fieldset>

      <div className="grid grid-cols-3 gap-2">
        <Button
          className={cn(TOUCH_TARGET, 'flex-col gap-0.5')}
          disabled={disabled}
          onClick={() => send({ action: 'restart' })}
          type="button"
          variant="outline"
        >
          <RotateCcwIcon />
          Restart
        </Button>

        <Button
          className={cn(TOUCH_TARGET, 'flex-col gap-0.5')}
          disabled={disabled}
          onClick={() => send({ action: snapshot.paused ? 'resume' : 'pause' })}
          type="button"
        >
          {snapshot.paused ? <PlayIcon /> : <PauseIcon />}
          {snapshot.paused ? 'Resume' : 'Pause'}
        </Button>

        <Button
          className={cn(TOUCH_TARGET, 'flex-col gap-0.5')}
          disabled={disabled}
          onClick={() => send({ action: 'next' })}
          type="button"
          variant="outline"
        >
          <SkipForwardIcon />
          Next
        </Button>
      </div>

      <Button
        className={cn(TOUCH_TARGET, 'w-full')}
        disabled={disabled}
        onClick={() => send({ action: 'exit' })}
        type="button"
        variant="destructive"
      >
        <LogOutIcon />
        Exit playback
      </Button>
    </section>
  );
};
