import { shiftStepLabel, shiftSteps } from '@/features/lyrics/utils/lrc-shift';
import { cn } from '@/shared/utils/cn';

import { ringFor } from './parts';

type LrcShiftProps = {
  onShift: (seconds: number) => void;
  disabled: boolean;
  focusedSlot: number | null;
  onFocusSlot: (slot: number) => void;
};

export const LrcShift = ({ onShift, disabled, focusedSlot, onFocusSlot }: LrcShiftProps) => (
  <div className="flex items-center gap-2 py-1.5">
    <span className="w-12 text-xs text-muted-foreground">Shift</span>
    <fieldset className="flex flex-wrap gap-1">
      <legend className="sr-only">Shift every timestamp</legend>
      {shiftSteps.map((step, index) => (
        <button
          key={step}
          type="button"
          disabled={disabled}
          onClick={() => onShift(step)}
          onMouseEnter={disabled ? undefined : () => onFocusSlot(index)}
          onFocus={disabled ? undefined : () => onFocusSlot(index)}
          className={cn(
            'rounded-md border px-2 py-1 font-mono text-xs transition-colors',
            disabled ? 'cursor-default opacity-45' : 'hover:bg-muted',
            !disabled && ringFor(focusedSlot === index),
          )}
        >
          {shiftStepLabel(step)}
        </button>
      ))}
    </fieldset>
    <span className="text-[11px] text-muted-foreground">
      Moves every timestamp; later is positive.
    </span>
  </div>
);
