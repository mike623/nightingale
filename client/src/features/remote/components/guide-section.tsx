import { MinusIcon, PlusIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { RemoteCommand, RemoteSnapshot } from '@/bridge/remote';
import { TOUCH_TARGET } from '@/features/remote/lib/touch-target';
import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/utils/cn';

type GuideSectionProps = {
  snapshot: RemoteSnapshot;
  disabled: boolean;
  send: (command: RemoteCommand) => void;
};

const STEP_PERCENT = 10;

/**
 * How long a press waits to be confirmed. The host publishes twice a second,
 * so anything past this means the command never took effect and the level on
 * screen should go back to the one the host is actually playing.
 */
const CONFIRM_TIMEOUT_MS = 2000;

/** Steps land on the percent grid, so the level stays readable on a phone. */
const steppedPercent = (from: number, direction: 1 | -1): number => {
  const steps = Math.round(from / STEP_PERCENT) + direction;

  return Math.min(Math.max(steps * STEP_PERCENT, 0), 100);
};

/**
 * Guide-vocal level, expressed to the host as a 0–1 volume. The buttons step it
 * rather than a slider, which a fingertip cannot place precisely.
 *
 * A press shows its own result at once and steps from it, rather than waiting
 * for the host's next snapshot: at two publishes a second a tap looked ignored,
 * and a second tap within the same interval stepped from the same stale level
 * and so asked for a volume the host already had. The host stays the authority
 * — its level is shown again as soon as it confirms, and after a press that it
 * never confirms.
 */
export const GuideSection = ({ snapshot, disabled, send }: GuideSectionProps) => {
  const published = Math.round(Math.min(Math.max(snapshot.guide_volume, 0), 1) * 100);
  const unavailable = !snapshot.guide_available;
  const locked = disabled || unavailable;

  const [pending, setPending] = useState<number | null>(null);

  if (pending !== null && pending === published) {
    setPending(null);
  }

  const shown = pending ?? published;

  useEffect(() => {
    if (pending === null) {
      return undefined;
    }

    const timer = setTimeout(() => setPending(null), CONFIRM_TIMEOUT_MS);

    return () => clearTimeout(timer);
  }, [pending]);

  const step = (direction: 1 | -1) => {
    const next = steppedPercent(shown, direction);

    setPending(next);
    send({ action: 'set_guide_volume', volume: next / 100 });
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Guide vocals</h2>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            aria-label="Lower guide vocals"
            className={TOUCH_TARGET}
            disabled={locked || shown === 0}
            onClick={() => step(-1)}
            type="button"
            variant="outline"
          >
            <MinusIcon />
          </Button>

          <span aria-live="polite" className="w-12 text-center text-sm tabular-nums">
            {shown}%
          </span>

          <Button
            aria-label="Raise guide vocals"
            className={TOUCH_TARGET}
            disabled={locked || shown === 100}
            onClick={() => step(1)}
            type="button"
            variant="outline"
          >
            <PlusIcon />
          </Button>
        </div>
      </div>

      {unavailable && (
        <p className="text-xs text-muted-foreground">
          This song has no separated vocal track to guide with.
        </p>
      )}

      <Button
        className={cn(TOUCH_TARGET, 'w-full')}
        disabled={locked}
        onClick={() => send({ action: 'toggle_guide' })}
        type="button"
        variant="outline"
      >
        Toggle guide vocals
      </Button>
    </section>
  );
};
