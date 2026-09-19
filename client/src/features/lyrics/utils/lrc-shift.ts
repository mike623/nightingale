/** Offsets applied to every timestamp, in seconds, in button order. */
const SHIFT_STEPS = [-1, -0.5, -0.1, 0.1, 0.5, 1] as const;

export const SHIFT_SLOTS = SHIFT_STEPS.length;

export const shiftSteps: readonly number[] = SHIFT_STEPS;

export const shiftStepAt = (slot: number): number | undefined => SHIFT_STEPS.at(slot);

export const shiftStepLabel = (step: number): string => `${step > 0 ? '+' : '−'}${Math.abs(step)}s`;
