/**
 * Drives the end-of-song result dialog: watches transport.isFinished + the
 * skip-outro pending flag, persists the run's score to the active profile,
 * plays the success chime, and exposes the props the result dialog needs.
 *
 * With auto-play-next on, finishing continues into another song instead of the
 * menu: a scoreless run rolls straight over, and a scored one holds the result
 * on screen for a short countdown first.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import successSoundUrl from '@/assets/sounds/success.mp3';
import { addScore } from '@/bridge/profile';
import {
  usePlaybackQueueQuery,
  useStartNextPlaybackQueueSong,
} from '@/features/playback-queue/use-playback-queue';
import {
  usePlaybackMicState,
  usePlaybackTranscriptActions,
  usePlaybackTranscriptState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import { useProfiles } from '@/features/profiles/queries/use-profiles';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';
import { PROFILES } from '@/shared/query-keys';
import type { ScoreRecord } from '@/types/ScoreRecord';
import type { Song } from '@/types/Song';

/** How long the result stays up before auto-play moves on. */
const AUTO_NEXT_SECONDS = 8;

export type PlaybackResult = {
  open: boolean;
  score: number;
  scores: ScoreRecord[];
  activeProfile: string | null;
  nextPending: boolean;
  /** Seconds left on the auto-advance countdown; null when it is off. */
  autoNextIn: number | null;
  onBack: () => void;
  onNext: () => void;
};

export type PlaybackResultOptions = {
  queuePlayback: boolean;
  autoPlayNext: boolean;
  /** Draws and starts a random analyzed song; used when the queue is empty. */
  playNext: () => void;
};

export function usePlaybackResult(
  song: Song,
  { queuePlayback, autoPlayNext, playNext }: PlaybackResultOptions,
): PlaybackResult {
  const fileHash = song.file_hash;
  const queryClient = useQueryClient();
  const { data: profileData, isLoading: profilesLoading } = useProfiles();
  const { data: entries = [] } = usePlaybackQueueQuery();
  const { isPreparing, playNext: playQueueNext } = useStartNextPlaybackQueueSong(entries);

  const { isFinished } = usePlaybackTransportState();
  const { handleExit } = usePlaybackTransportActions();
  const { rawScore } = usePlaybackMicState();
  const { skipOutroPending } = usePlaybackTranscriptState();
  const { clearSkipOutroPending } = usePlaybackTranscriptActions();

  const [showResult, setShowResult] = useState(false);
  const [resultScore, setResultScore] = useState(0);
  const [autoNextIn, setAutoNextIn] = useState<number | null>(null);

  const scoreRef = useLatestRef(rawScore);
  const finishHandledRef = useRef(false);
  // The finish effect must not re-run when these change identity mid-song.
  const autoNextRef = useLatestRef({ autoPlayNext, playNext });

  useEffect(() => {
    if (!isFinished && !skipOutroPending) {
      return;
    }

    if (profilesLoading) {
      return;
    }

    if (finishHandledRef.current) {
      return;
    }

    finishHandledRef.current = true;
    clearSkipOutroPending();

    const finalScore = scoreRef.current;
    const active = profileData?.active ?? null;
    const shouldShowResult = queuePlayback || finalScore > 0;

    // Leaving without a result: continue into another song, or exit.
    const leaveSession = () => {
      if (autoNextRef.current.autoPlayNext) {
        autoNextRef.current.playNext();
      } else {
        handleExit();
      }
    };

    if (!shouldShowResult) {
      leaveSession();
      return;
    }

    void (async () => {
      try {
        if (active !== null) {
          await addScore(fileHash, finalScore);
          await queryClient.invalidateQueries({ queryKey: PROFILES });
        }
      } catch (e) {
        toast.error(`Could not save score: ${e instanceof Error ? e.message : String(e)}`);
      }
      setResultScore(finalScore);
      setShowResult(true);
      if (autoNextRef.current.autoPlayNext) {
        setAutoNextIn(AUTO_NEXT_SECONDS);
      }
    })();
  }, [
    autoNextRef,
    isFinished,
    skipOutroPending,
    fileHash,
    handleExit,
    profileData,
    profilesLoading,
    queryClient,
    clearSkipOutroPending,
    scoreRef,
    queuePlayback,
  ]);

  useEffect(() => {
    if (!showResult) {
      return undefined;
    }

    const audioEl = new Audio(successSoundUrl);
    void audioEl.play().catch(() => {});

    return () => {
      audioEl.pause();
      audioEl.src = '';
    };
  }, [showResult]);

  const hasQueueNext = queuePlayback && entries.length > 0;

  const onNext = useCallback(() => {
    setAutoNextIn(null);
    // The queued start keeps the dialog up behind its "Preparing…" spinner; a
    // random draw unmounts this session, so hiding it first avoids a flash.
    if (hasQueueNext) {
      playQueueNext();
      return;
    }
    setShowResult(false);
    playNext();
  }, [hasQueueNext, playQueueNext, playNext]);

  useEffect(() => {
    if (autoNextIn === null) {
      return undefined;
    }

    // The last tick starts the next song from inside the timer rather than
    // counting down to zero and reacting to it, so the effect never advances
    // state synchronously as it runs.
    const timer = setTimeout(() => {
      if (autoNextIn <= 1) {
        onNext();
        return;
      }
      setAutoNextIn((left) => (left === null ? null : left - 1));
    }, 1000);

    return () => clearTimeout(timer);
  }, [autoNextIn, onNext]);

  const onBack = useCallback(() => {
    setAutoNextIn(null);
    setShowResult(false);
    handleExit();
  }, [handleExit]);

  return {
    open: showResult,
    score: resultScore,
    scores: profileData?.scores ?? [],
    activeProfile: profileData?.active ?? null,
    nextPending: isPreparing,
    autoNextIn,
    onBack,
    onNext,
  };
}
