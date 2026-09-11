/**
 * Drives the end-of-song result dialog: watches transport.isFinished + the
 * skip-outro pending flag, persists the run's score to the active profile,
 * plays the success chime, and exposes the props the result dialog needs.
 *
 * With auto-play-next on, finishing continues into another random song instead
 * of the menu: a scoreless run rolls straight over, and a scored one holds the
 * result on screen for a short countdown first.
 */

import successSoundUrl from "@/assets/sounds/success.mp3";
import {
  usePlaybackMicState,
  usePlaybackTranscriptActions,
  usePlaybackTranscriptState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from "@/contexts/playback";
import { PROFILES } from "@/queries/keys";
import { useProfiles } from "@/queries/use-profiles";
import { addScore } from "@/bridge/profile";
import type { ScoreRecord } from "@/types/ScoreRecord";
import type { Song } from "@/types/Song";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

/** How long the result stays up before auto-play moves on. */
const AUTO_NEXT_SECONDS = 8;

export interface PlaybackResult {
  open: boolean;
  score: number;
  scores: ScoreRecord[];
  activeProfile: string | null;
  onFinish: () => void;
  onNext: () => void;
  /** Seconds left on the auto-advance countdown; null when it is off. */
  autoNextIn: number | null;
}

export interface PlaybackResultOptions {
  autoPlayNext: boolean;
  playNext: () => void;
}

export function usePlaybackResult(
  song: Song,
  { autoPlayNext, playNext }: PlaybackResultOptions,
): PlaybackResult {
  const fileHash = song.file_hash;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: profileData, isLoading: profilesLoading } = useProfiles();

  const { isFinished } = usePlaybackTransportState();
  const { handleExit } = usePlaybackTransportActions();
  const { rawScore } = usePlaybackMicState();
  const { skipOutroPending } = usePlaybackTranscriptState();
  const { clearSkipOutroPending } = usePlaybackTranscriptActions();

  const [showResult, setShowResult] = useState(false);
  const [resultScore, setResultScore] = useState(0);
  const [autoNextIn, setAutoNextIn] = useState<number | null>(null);

  const scoreRef = useRef(rawScore);
  scoreRef.current = rawScore;
  const finishHandledRef = useRef(false);
  // The finish effect must not re-run when these change identity mid-song.
  const autoNextRef = useRef({ autoPlayNext, playNext });
  autoNextRef.current = { autoPlayNext, playNext };

  useEffect(() => {
    if (!isFinished && !skipOutroPending) {
      return;
    }

    if (profilesLoading && !profileData) {
      return;
    }

    if (finishHandledRef.current) {
      return;
    }

    finishHandledRef.current = true;
    clearSkipOutroPending();

    const finalScore = scoreRef.current;
    const active = profileData?.active ?? null;
    const shouldShowResult = finalScore > 0;

    // Leaving without a result: continue into another song, or go home.
    const leaveSession = () => {
      if (autoNextRef.current.autoPlayNext) {
        autoNextRef.current.playNext();
      } else {
        navigate("/", { replace: true });
      }
    };

    if (!shouldShowResult) {
      leaveSession();
      return;
    }

    void (async () => {
      try {
        if (active != null) {
          await addScore(fileHash, finalScore);
          await queryClient.invalidateQueries({ queryKey: PROFILES });
        }
        setResultScore(finalScore);
        setShowResult(true);
        if (autoNextRef.current.autoPlayNext) {
          setAutoNextIn(AUTO_NEXT_SECONDS);
        }
      } catch (e) {
        toast.error(`Could not save score: ${e instanceof Error ? e.message : String(e)}`);
        leaveSession();
      }
    })();
  }, [
    isFinished,
    skipOutroPending,
    fileHash,
    navigate,
    profileData,
    profilesLoading,
    queryClient,
    clearSkipOutroPending,
  ]);

  useEffect(() => {
    if (!showResult) {
      return;
    }

    const audioEl = new Audio(successSoundUrl);
    void audioEl.play().catch(() => {});

    return () => {
      audioEl.pause();
      audioEl.src = "";
    };
  }, [showResult]);

  const onNext = useCallback(() => {
    setAutoNextIn(null);
    setShowResult(false);
    playNext();
  }, [playNext]);

  useEffect(() => {
    if (autoNextIn === null) {
      return;
    }

    if (autoNextIn <= 0) {
      onNext();
      return;
    }

    const timer = setTimeout(
      () => setAutoNextIn((left) => (left === null ? null : left - 1)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [autoNextIn, onNext]);

  const onFinish = useCallback(() => {
    setAutoNextIn(null);
    setShowResult(false);
    handleExit();
  }, [handleExit]);

  return {
    open: showResult,
    score: resultScore,
    scores: profileData?.scores ?? [],
    activeProfile: profileData?.active ?? null,
    onFinish,
    onNext,
    autoNextIn,
  };
}
