/**
 * Drives the end-of-song result dialog: watches transport.isFinished + the
 * skip-outro pending flag, persists each player's score to their profile,
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
import type { PlaybackPlayer } from '@/bridge/playback-session';
import { addScore } from '@/bridge/profile';
import type { PlaybackNext } from '@/features/playback/hooks/use-playback-next';
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

export type PlaybackPlayerResult = {
  id: string;
  profile: string | null;
  score: number;
};

type FinalResultsInput = {
  multiplayer: boolean;
  players: ReturnType<typeof usePlaybackMicState>['players'];
  activeProfile: string | null;
  soloScore: number;
};

function buildFinalResults(input: FinalResultsInput): PlaybackPlayerResult[] {
  if (!input.multiplayer) {
    return [{ id: 'solo', profile: input.activeProfile, score: input.soloScore }];
  }
  return input.players.map((player) => ({
    id: player.id,
    profile: player.profile,
    score: player.rawScore,
  }));
}

function finishReady(
  isFinished: boolean,
  skipOutroPending: boolean,
  profilesLoading: boolean,
  alreadyHandled: boolean,
): boolean {
  return (isFinished || skipOutroPending) && !profilesLoading && !alreadyHandled;
}

export type PlaybackResult = {
  open: boolean;
  results: PlaybackPlayerResult[];
  scores: ScoreRecord[];
  nextPending: boolean;
  /** Seconds left on the auto-advance countdown; null when it is off. */
  autoNextIn: number | null;
  onBack: () => void;
  onNext: (players?: readonly PlaybackPlayer[]) => void;
  onStopAutoNext: () => void;
};

export type PlaybackResultOptions = {
  queuePlayback: boolean;
  autoPlayNext: boolean;
  /** Starts the next song: the queue's head, or a random draw. */
  next: PlaybackNext;
};

export function usePlaybackResult(
  song: Song,
  { queuePlayback, autoPlayNext, next }: PlaybackResultOptions,
): PlaybackResult {
  const fileHash = song.file_hash;
  const queryClient = useQueryClient();
  const { data: profileData, isLoading: profilesLoading } = useProfiles();

  const { isFinished } = usePlaybackTransportState();
  const { handleExit } = usePlaybackTransportActions();
  const { rawScore, players: micPlayers, multiplayer } = usePlaybackMicState();
  const { skipOutroPending } = usePlaybackTranscriptState();
  const { clearSkipOutroPending } = usePlaybackTranscriptActions();

  const [showResult, setShowResult] = useState(false);
  const [results, setResults] = useState<PlaybackPlayerResult[]>([]);
  const micPlayersRef = useLatestRef(micPlayers);
  const scoreRef = useLatestRef(rawScore);
  const finishHandledRef = useRef(false);
  const [autoNextIn, setAutoNextIn] = useState<number | null>(null);
  // The finish effect must not re-run when these change identity mid-song.
  const autoNextRef = useLatestRef({ autoPlayNext, next });

  useEffect(() => {
    if (!finishReady(isFinished, skipOutroPending, profilesLoading, finishHandledRef.current)) {
      return;
    }

    finishHandledRef.current = true;
    clearSkipOutroPending();

    const finalResults = buildFinalResults({
      multiplayer,
      players: micPlayersRef.current,
      activeProfile: profileData?.active ?? null,
      soloScore: scoreRef.current,
    });
    const shouldShowResult =
      multiplayer || queuePlayback || finalResults.some((result) => result.score > 0);

    if (!shouldShowResult) {
      // Leaving without a result: continue into another song, or exit.
      if (autoNextRef.current.autoPlayNext) {
        autoNextRef.current.next.playNext();
      } else {
        handleExit();
      }
      return;
    }

    void (async () => {
      try {
        await Promise.all(
          finalResults.flatMap((result) =>
            result.profile === null ? [] : [addScore(fileHash, result.score, result.profile)],
          ),
        );
        if (finalResults.some((result) => result.profile !== null)) {
          await queryClient.invalidateQueries({ queryKey: PROFILES });
        }
      } catch (error) {
        toast.error(
          `Could not save score: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      setResults(finalResults.toSorted((left, right) => right.score - left.score));
      setShowResult(true);
      if (autoNextRef.current.autoPlayNext) {
        setAutoNextIn(AUTO_NEXT_SECONDS);
      }
    })();
  }, [
    autoNextRef,
    clearSkipOutroPending,
    fileHash,
    handleExit,
    isFinished,
    micPlayersRef,
    multiplayer,
    profileData?.active,
    profilesLoading,
    queryClient,
    queuePlayback,
    scoreRef,
    skipOutroPending,
  ]);

  useEffect(() => {
    if (!showResult) {
      return undefined;
    }

    const audioElement = new Audio(successSoundUrl);
    void audioElement.play().catch(() => {});

    return () => {
      audioElement.pause();
      audioElement.src = '';
    };
  }, [showResult]);

  const onNext = useCallback(
    (nextPlayers?: readonly PlaybackPlayer[]) => {
      setAutoNextIn(null);
      // The queued start keeps the dialog up behind its "Preparing…" spinner; a
      // random draw unmounts this session, so hiding it first avoids a flash.
      if (!next.hasQueueNext) {
        setShowResult(false);
      }
      if (nextPlayers === undefined) {
        next.playNext();
      } else {
        next.playNextWith(nextPlayers);
      }
    },
    [next],
  );

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

  const onStopAutoNext = useCallback(() => setAutoNextIn(null), []);

  const onBack = useCallback(() => {
    setAutoNextIn(null);
    setShowResult(false);
    handleExit();
  }, [handleExit]);

  return {
    open: showResult,
    results,
    scores: profileData?.scores ?? [],
    nextPending: next.isPreparing,
    autoNextIn,
    onBack,
    onNext,
    onStopAutoNext,
  };
}
