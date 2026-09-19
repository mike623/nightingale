import { useEffect, useState } from 'react';

import type { RemoteSnapshot } from '@/bridge/remote';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';

const clamp = (positionMs: number, durationMs: number): number =>
  Math.min(Math.max(positionMs, 0), durationMs);

/**
 * Playback position in media milliseconds, smoothed between publishes.
 *
 * The host is the only clock that counts, and it publishes about twice a
 * second — too coarse for a moving bar. Between publishes the position is
 * extrapolated from the wall clock; every snapshot, not merely every changed
 * value, resets that baseline, so the two can never diverge by more than one
 * publish interval. A paused host is reported exactly as published.
 */
export function useRemotePosition(snapshot: RemoteSnapshot | null): number {
  const [positionMs, setPositionMs] = useState(0);
  const snapshotRef = useLatestRef(snapshot);

  useEffect(() => {
    let frame = 0;
    let baseline: RemoteSnapshot | null | undefined;
    let baselineAtMs = 0;

    const tick = (): void => {
      const current = snapshotRef.current;

      if (current !== baseline) {
        baseline = current;
        baselineAtMs = performance.now();
      }

      const publishedMs = baseline?.position_ms ?? 0;
      const elapsedMs = baseline?.paused === false ? performance.now() - baselineAtMs : 0;

      setPositionMs(clamp(publishedMs + elapsedMs, baseline?.duration_ms ?? 0));
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [snapshotRef]);

  return positionMs;
}
