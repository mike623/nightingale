/**
 * Makes this playback session the host of the remote-control relay: it
 * publishes what is on screen and applies the commands phones send back.
 *
 * Commands go through the same dispatcher the keyboard uses, so a phone can
 * never reach behaviour the keyboard cannot — there is one implementation of
 * what pausing or skipping an intro means, and this hook does not get its own.
 *
 * Publishing is a fixed tick rather than a reactive effect because the field
 * that changes most, playback position, advances continuously. One tick covers
 * both it and every discrete change within the interval, and a phone that
 * joins mid-song gets the relay's stored snapshot immediately.
 */

import { useEffect, useMemo } from 'react';

import { connectRemote, type RemoteCommand, type RemoteSnapshot } from '@/bridge/remote';
import { themeName } from '@/features/playback/components/theme';
import { useLyricsHidden } from '@/features/playback/hooks/use-lyrics-hidden';
import { usePlaybackCommandDeps } from '@/features/playback/hooks/use-playback-command-deps';
import {
  dispatchPlaybackCommand,
  resolveSkipCommand,
} from '@/features/playback/lib/playback-commands';
import {
  usePlaybackMicState,
  usePlaybackThemeState,
  usePlaybackTranscriptState,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import { useLatestRef } from '@/shared/hooks/use-latest-ref';
import type { AppConfig } from '@/types/AppConfig';
import type { Song } from '@/types/Song';

/** Two publishes a second: smooth enough to follow, small enough to ignore. */
const PUBLISH_INTERVAL_MS = 500;

const SECONDS_TO_MS = 1000;

const toMs = (seconds: number): number =>
  (Number.isFinite(seconds) ? Math.max(0, seconds) : 0) * SECONDS_TO_MS;

export function useRemoteHost(song: Song, config: AppConfig | null, playNext: () => void): void {
  const deps = usePlaybackCommandDeps(config, playNext);
  const { paused, duration, guideVolume, guideAvailable } = usePlaybackTransportState();
  const { themeIndex, videoFlavor } = usePlaybackThemeState();
  const { micUserEnabled, micMonitorUserEnabled, micName, rawScore } = usePlaybackMicState();
  const { lyricOffsetSec } = usePlaybackTranscriptState();
  const [lyricsHidden] = useLyricsHidden();

  // The desktop listener binds to the local network, so it stays off until the
  // operator turns it on. The self-hosted server is already listening, but the
  // same switch decides whether a phone finds a host to talk to, so one setting
  // governs both targets.
  const enabled = config?.remote_control === true;

  // Shifting the lyrics changes what the whole room reads, so it is the one
  // command the phone page may send that the host only performs when the
  // operator has turned it on. The check lives here rather than in the shared
  // dispatcher: it is a rule about this surface, not about the command.
  const lyricShiftAllowed = config?.party_lyric_shift === true;

  const snapshotSource = useMemo(
    () => ({
      song,
      paused,
      duration,
      guideVolume,
      guideAvailable,
      themeIndex,
      videoFlavor,
      micUserEnabled,
      micMonitorUserEnabled,
      micName,
      rawScore,
      lyricsHidden,
      lyricOffsetSec,
      lyricShiftAllowed,
      deps,
    }),
    [
      song,
      paused,
      duration,
      guideVolume,
      guideAvailable,
      themeIndex,
      videoFlavor,
      micUserEnabled,
      micMonitorUserEnabled,
      micName,
      rawScore,
      lyricsHidden,
      lyricOffsetSec,
      lyricShiftAllowed,
      deps,
    ],
  );

  const sourceRef = useLatestRef(snapshotSource);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const buildSnapshot = (): RemoteSnapshot => {
      const current = sourceRef.current;
      const skip = resolveSkipCommand(current.deps);

      return {
        song: {
          file_hash: current.song.file_hash,
          title: current.song.title,
          artist: current.song.artist,
        },
        paused: current.paused,
        position_ms: toMs(current.deps.getCurrentTime()),
        duration_ms: toMs(current.duration),
        guide_volume: current.guideVolume,
        guide_available: current.guideAvailable,
        lyrics_hidden: current.lyricsHidden,
        theme_index: current.themeIndex,
        theme_name: themeName(current.themeIndex, current.videoFlavor),
        flavor_name: current.videoFlavor,
        score: Math.max(0, Math.round(current.rawScore)),
        mic_enabled: current.micUserEnabled,
        mic_monitor_enabled: current.micMonitorUserEnabled,
        mic_name: current.micName,
        can_skip_intro: skip?.action === 'skip_intro',
        can_skip_outro: skip?.action === 'skip_outro',
        lyric_offset_ms: Math.round(current.lyricOffsetSec * SECONDS_TO_MS),
      };
    };

    const applyCommand = (command: RemoteCommand): void => {
      if (command.action === 'shift_lyrics' && !sourceRef.current.lyricShiftAllowed) {
        return;
      }

      dispatchPlaybackCommand(command, sourceRef.current.deps);
    };

    const link = connectRemote(
      {
        onConnection: () => {},
        onSession: () => {},
        onSnapshot: () => {},
        onDeny: () => {},
        onCommand: applyCommand,
      },
      'host',
    );

    link.publish(buildSnapshot());
    const timer = window.setInterval(() => link.publish(buildSnapshot()), PUBLISH_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      link.close();
    };
  }, [enabled, sourceRef]);
}
