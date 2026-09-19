import { useState } from 'react';

import type { RemoteCommand, RemoteSnapshot } from '@/bridge/remote';
import { TOUCH_TARGET } from '@/features/remote/lib/touch-target';
import { Button } from '@/shared/components/ui/button';
import { Slider } from '@/shared/components/ui/slider';
import { cn } from '@/shared/utils/cn';

type GuideSectionProps = {
  snapshot: RemoteSnapshot;
  disabled: boolean;
  send: (command: RemoteCommand) => void;
};

/**
 * Guide-vocal level, expressed to the host as a 0–1 volume. The slider shows
 * the finger's position while dragging and the host's published level at all
 * other times.
 */
export const GuideSection = ({ snapshot, disabled, send }: GuideSectionProps) => {
  const [dragPercent, setDragPercent] = useState<number | null>(null);

  const published = Math.round(Math.min(Math.max(snapshot.guide_volume, 0), 1) * 100);
  const shownPercent = dragPercent ?? published;
  const unavailable = !snapshot.guide_available;
  const locked = disabled || unavailable;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium">Guide vocals</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{shownPercent}%</span>
      </div>

      {unavailable && (
        <p className="text-xs text-muted-foreground">
          This song has no separated vocal track to guide with.
        </p>
      )}

      <fieldset>
        <legend className="sr-only">Guide vocal volume</legend>

        <Slider
          disabled={locked}
          max={100}
          min={0}
          onValueChange={([value]) => setDragPercent(value)}
          onValueCommit={([value]) => {
            send({ action: 'set_guide_volume', volume: value / 100 });
            setDragPercent(null);
          }}
          step={1}
          value={[shownPercent]}
        />
      </fieldset>

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
