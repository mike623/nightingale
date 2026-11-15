import { useEffect, useRef, useState } from 'react';

import type { TimeSubscriber } from '@/features/playback/hooks/use-audio-player';
import {
  DEFAULT_MIC_LATENCY_COMPENSATION_SEC,
  MAX_MIC_LATENCY_COMPENSATION_SEC,
  MIN_MIC_LATENCY_COMPENSATION_SEC,
  PITCH_WINDOW_SAMPLES,
  SEMITONE_TOLERANCE,
} from '@/features/playback/lib/pitch/constants';
import { createPitchDetector, detectPitchFromSamples } from '@/features/playback/lib/pitch/detect';
import type { PitchSeries, ReferencePitchTrack } from '@/features/playback/lib/pitch/state';
import {
  analyzeReferencePitches,
  PitchScoring,
  PitchStateBuffer,
  pitchSimilarity,
  sampleVocalsWindow,
} from '@/features/playback/lib/pitch/state';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';

export type PitchScoringSource = {
  isReady: boolean;
  duration: number;
  getReferenceBuffer: () => AudioBuffer | null;
  subscribe: (fn: TimeSubscriber) => () => void;
  /** Seeks taken so far; a change means the current pass over the song ended. */
  getSeekEpoch: () => number;
};

export function usePitchScoring(
  { isReady, duration, getReferenceBuffer, subscribe, getSeekEpoch }: PitchScoringSource,
  micPitch: number | null,
  latencyCompensationSec = DEFAULT_MIC_LATENCY_COMPENSATION_SEC,
  toleranceSemitones: number = SEMITONE_TOLERANCE,
) {
  const refDetector = useRef(createPitchDetector());
  const scratchRef = useRef(new Float32Array(PITCH_WINDOW_SAMPLES));
  const bufferRef = useRef(new PitchStateBuffer());
  const scoringRef = useRef(new PitchScoring(1));
  const referenceTrackRef = useRef<ReferencePitchTrack | null>(null);
  const micPitchRef = useLatestRef(micPitch);
  const toleranceRef = useLatestRef(toleranceSemitones);
  const latencyRef = useLatestRef(
    Math.min(
      MAX_MIC_LATENCY_COMPENSATION_SEC,
      Math.max(MIN_MIC_LATENCY_COMPENSATION_SEC, latencyCompensationSec),
    ),
  );
  /** The pass the current history and score belong to. */
  const appliedEpochRef = useRef(0);
  const [series, setSeries] = useState<PitchSeries>({
    refPitches: [],
    userPitches: [],
    displaySemitones: [],
    similarities: [],
    times: [],
    referenceTrack: null,
    referenceTime: 0,
    currentTime: 0,
  });
  const [score, setScore] = useState(0);

  useEffect(() => {
    if (!isReady || duration <= 0) {
      return;
    }
    bufferRef.current.reset();

    const reference = getReferenceBuffer();
    const track = reference ? analyzeReferencePitches(reference) : null;
    bufferRef.current.setOctaveAnchor(track?.octaveAnchorSemitone ?? null);
    referenceTrackRef.current = track;
    scoringRef.current = new PitchScoring(track?.singableTime ?? duration);

    setSeries(bufferRef.current.snapshot());
    setScore(0);
  }, [isReady, duration, getReferenceBuffer]);

  useEffect(() => {
    if (!isReady) {
      return undefined;
    }

    const run = (t: number) => {
      // A seek ends the pass: the graph's history belongs to a stretch of the
      // song that is no longer playing, and the score measured it. Both start
      // over from the new position, while the singable total established from
      // the reference vocals survives. A seek notifies subscribers even while
      // paused, so the readouts clear at the seek rather than on resume.
      const epoch = getSeekEpoch();
      if (appliedEpochRef.current !== epoch) {
        appliedEpochRef.current = epoch;
        bufferRef.current.reset();
        bufferRef.current.setOctaveAnchor(referenceTrackRef.current?.octaveAnchorSemitone ?? null);
        scoringRef.current.reset();
        setSeries(bufferRef.current.snapshot());
        setScore(0);
      }

      if (t <= 0) {
        return;
      }

      const reference = getReferenceBuffer();
      const track = referenceTrackRef.current;
      const mp = micPitchRef.current;
      const referenceTime = Math.max(0, t - latencyRef.current);
      const refHz =
        reference && sampleVocalsWindow(reference, t, scratchRef.current, latencyRef.current)
          ? detectPitchFromSamples(refDetector.current, scratchRef.current, reference.sampleRate)
          : null;
      const sim =
        refHz !== null && mp !== null ? pitchSimilarity(refHz, mp, toleranceRef.current) : 0;

      bufferRef.current.tryPush(refHz, mp, sim, t);
      scoringRef.current.accumulate(t, refHz, mp, sim);

      const snapshot = bufferRef.current.snapshot();
      snapshot.referenceTrack = track;
      snapshot.referenceTime = referenceTime;
      snapshot.currentTime = t;
      setSeries(snapshot);
      setScore(scoringRef.current.score());
    };

    return subscribe(run);
  }, [getReferenceBuffer, getSeekEpoch, isReady, latencyRef, micPitchRef, subscribe, toleranceRef]);

  return { series, score };
}
