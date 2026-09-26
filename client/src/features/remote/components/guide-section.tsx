import { MinusIcon, PlusIcon } from 'lucide-react';

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

/** Steps land on the percent grid, so the level stays readable on a phone. */
const steppedPercent = (published: number, direction: 1 | -1): number => {
  const steps = Math.round(published / STEP_PERCENT) + direction;

  return Math.min(Math.max(steps * STEP_PERCENT, 0), 100);
};

/**
 * Guide-vocal level, expressed to the host as a 0–1 volume. The percentage is
 * always the host's published level; the buttons step it rather than a slider,
 * which a fingertip cannot place precisely.
 */
export const GuideSection = ({ snapshot, disabled, send }: GuideSectionProps) => {
  const published = Math.round(Math.min(Math.max(snapshot.guide_volume, 0), 1) * 100);
  const unavailable = !snapshot.guide_available;
  const locked = disabled || unavailable;

  const step = (direction: 1 | -1) => {
    send({ action: 'set_guide_volume', volume: steppedPercent(published, direction) / 100 });
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Guide vocals</h2>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            aria-label="Lower guide vocals"
            className={TOUCH_TARGET}
            disabled={locked || published === 0}
            onClick={() => step(-1)}
            type="button"
            variant="outline"
          >
            <MinusIcon />
          </Button>

          <span className="w-12 text-center text-sm tabular-nums" aria-live="polite">
            {published}%
          </span>

          <Button
            aria-label="Raise guide vocals"
            className={TOUCH_TARGET}
            disabled={locked || published === 100}
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
