/**
 * Gathers everything a `PlaybackCommand` needs from the playback contexts.
 *
 * Both control surfaces — the keyboard/gamepad and the phone remote — dispatch
 * the same commands, so they must dispatch them against the same dependencies.
 * Assembling this twice would let the two drift apart one field at a time,
 * which is exactly the fork the architecture rules exist to prevent.
 */

import { useCallback, useMemo } from 'react';

import { useLyricsHidden } from '@/features/playback/hooks/use-lyrics-hidden';
import { usePlaybackConfigPersist } from '@/features/playback/hooks/use-playback-config-persist';
import type { PlaybackCommandDeps } from '@/features/playback/lib/playback-commands';
import {
  usePlaybackMicActions,
  usePlaybackThemeActions,
  usePlaybackTranscriptActions,
  usePlaybackTranscriptState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import type { AppConfig } from '@/types/AppConfig';

export function usePlaybackCommandDeps(
  config: AppConfig | null,
  playNext: () => void,
): PlaybackCommandDeps {
  const { paused, isReady, isFinished, guideVolume, guideAvailable } = usePlaybackTransportState();
  const { getCurrentTime, seek, setGuideVolume, handlePause, handleContinue, handleExit } =
    usePlaybackTransportActions();
  const { cycleTheme, cycleFlavor } = usePlaybackThemeActions();
  const [, setLyricsHidden] = useLyricsHidden();
  const toggleLyricsHidden = useCallback(() => {
    setLyricsHidden((hidden) => !hidden);
  }, [setLyricsHidden]);
  const { firstSegmentStart, lastSegmentEnd, introSkipLeadSec, skipOutroPending } =
    usePlaybackTranscriptState();
  const { handleSkipIntro, handleSkipOutro } = usePlaybackTranscriptActions();
  const { handleToggleMic, handleCycleMic, handleToggleMicMonitor } = usePlaybackMicActions();

  const persistConfig = usePlaybackConfigPersist(config);

  return useMemo<PlaybackCommandDeps>(
    () => ({
      paused,
      // Once the result dialog is up it owns advancing (and has its own Next
      // Song button), so skipping from here would double up. Skip Outro opens
      // it via `skipOutroPending` without ever setting `isFinished`.
      nextBlocked: isFinished || skipOutroPending,
      isReady,
      guideVolume,
      guideAvailable,
      firstSegmentStart,
      lastSegmentEnd,
      introSkipLeadSec,
      getCurrentTime,
      seek,
      handlePause,
      handleContinue,
      handleExit,
      playNext,
      setGuideVolume,
      persistConfig,
      cycleTheme,
      cycleFlavor,
      toggleLyricsHidden,
      handleToggleMic,
      handleCycleMic,
      handleToggleMicMonitor,
      handleSkipIntro,
      handleSkipOutro,
    }),
    [
      paused,
      isFinished,
      skipOutroPending,
      isReady,
      guideVolume,
      guideAvailable,
      firstSegmentStart,
      lastSegmentEnd,
      introSkipLeadSec,
      getCurrentTime,
      seek,
      handlePause,
      handleContinue,
      handleExit,
      playNext,
      setGuideVolume,
      persistConfig,
      cycleTheme,
      cycleFlavor,
      toggleLyricsHidden,
      handleToggleMic,
      handleCycleMic,
      handleToggleMicMonitor,
      handleSkipIntro,
      handleSkipOutro,
    ],
  );
}
