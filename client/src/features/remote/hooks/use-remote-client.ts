/**
 * Adapts the queue link's published host state to the phone page's screens,
 * and maps each screen action onto the queue link's whitelisted commands. The
 * host stays the authority: a refused action only surfaces as `denial`.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  requestPlaybackControl,
  type PlaybackControl,
  type PlaybackOptions,
  type PlaybackProgress,
} from '@/bridge/playback-remote';
import {
  loadPlaybackStatus,
  onPlaybackStatusChanged,
  requestPlaybackCommand,
  requestRandomPlayback,
} from '@/bridge/playback-status';
import { useRemotePlayback } from '@/features/remote/hooks/use-remote-playback';
import { errorMessage } from '@/features/remote/lib/error-message';
import type {
  RemoteCommand,
  RemoteConnectionState,
  RemoteSnapshot,
} from '@/features/remote/lib/remote-model';
import { PLAYBACK_STATUS } from '@/shared/query-keys';

/** How long a refusal stays on screen before the page stops mentioning it. */
const DENIAL_VISIBLE_MS = 4000;

/** Volume `toggle_guide` restores when the guide stem is currently silent. */
const GUIDE_TOGGLE_VOLUME = 0.3;

export type RemoteClient = {
  snapshot: RemoteSnapshot | null;
  connection: RemoteConnectionState;
  /** Last refusal from the host, cleared shortly after it arrives. */
  denial: string | null;
  send: (command: RemoteCommand) => void;
};

type Keyed = { key: string };

/** The entry after `current` in a published list, wrapping at the end. */
const nextKey = (items: readonly Keyed[], current: string): string | undefined => {
  if (items.length === 0) {
    return undefined;
  }
  const index = items.findIndex((item) => item.key === current);
  return items[(index + 1) % items.length]?.key;
};

const labelOf = (items: readonly (Keyed & { label: string })[], key: string): string =>
  items.find((item) => item.key === key)?.label ?? '';

const micName = (options: PlaybackOptions): string | null =>
  options.microphones.find((mic) => mic.deviceId === options.selectedMicId)?.label ?? null;

const toSnapshot = (progress: PlaybackProgress, options: PlaybackOptions): RemoteSnapshot => ({
  song:
    progress.fileHash === null
      ? null
      : {
          file_hash: progress.fileHash,
          title: progress.title ?? '',
          artist: progress.artist ?? '',
        },
  paused: progress.paused,
  playing: progress.playing,
  position_ms: progress.positionMs,
  duration_ms: progress.durationMs,
  guide_volume: options.guideVolume,
  guide_available: options.guideAvailable,
  lyrics_hidden: options.lyricsHidden,
  theme_name: labelOf(options.themes, options.themeKey),
  flavor_name: labelOf(options.flavors, options.flavorKey),
  flavor_available: options.flavorAvailable,
  score: progress.score,
  multiplayer: options.multiplayer,
  mic_enabled: options.micEnabled,
  mic_monitor_enabled: options.micMonitorEnabled,
  mic_name: micName(options),
  can_skip_intro: progress.skipIntro,
  can_skip_outro: progress.skipOutro,
  lyric_offset_ms: options.lyricOffsetMs,
  lyric_shift_allowed: options.lyricShiftAllowed,
});

type Request =
  | { kind: 'command'; command: 'pause' | 'resume' | 'next' | 'exit' }
  | { kind: 'control'; control: PlaybackControl }
  | { kind: 'random' }
  | null;

const control = (value: PlaybackControl): Request => ({ kind: 'control', control: value });

/** Actions that read the host's published lists to pick their target. */
const CYCLE_ACTIONS = ['cycle_theme', 'cycle_flavor', 'cycle_mic', 'toggle_guide'] as const;
type CycleCommand = Extract<RemoteCommand, { action: (typeof CYCLE_ACTIONS)[number] }>;
const isCycle = (command: RemoteCommand): command is CycleCommand =>
  CYCLE_ACTIONS.some((action) => action === command.action);

type PayloadAction = 'seek' | 'set_guide_volume' | 'shift_lyrics';
type SimpleAction = Exclude<RemoteCommand['action'], CycleCommand['action'] | PayloadAction>;

/** Actions with nothing to read: each is one fixed request. */
const SIMPLE_REQUESTS: Record<SimpleAction, Request> = {
  pause: { kind: 'command', command: 'pause' },
  resume: { kind: 'command', command: 'resume' },
  next: { kind: 'command', command: 'next' },
  exit: { kind: 'command', command: 'exit' },
  start_random: { kind: 'random' },
  restart: control({ type: 'seek', positionMs: 0 }),
  toggle_lyrics: control({ type: 'toggle-lyrics' }),
  toggle_mic: control({ type: 'toggle-mic' }),
  toggle_mic_monitor: control({ type: 'toggle-monitoring' }),
  skip_intro: control({ type: 'skip-intro' }),
  skip_outro: control({ type: 'skip-outro' }),
};

const selectRequest = (key: string | undefined, make: (key: string) => PlaybackControl): Request =>
  key === undefined ? null : control(make(key));

/** None of these carry a payload; each reads the list the host published. */
const CYCLE_REQUESTS: Record<CycleCommand['action'], (options: PlaybackOptions) => Request> = {
  cycle_theme: (options) =>
    selectRequest(nextKey(options.themes, options.themeKey), (key) => ({
      type: 'select-theme',
      key,
    })),
  cycle_flavor: (options) =>
    selectRequest(nextKey(options.flavors, options.flavorKey), (key) => ({
      type: 'select-flavor',
      key,
    })),
  cycle_mic: (options) =>
    selectRequest(
      nextKey(
        options.microphones.map((mic) => ({ key: mic.deviceId })),
        options.selectedMicId ?? '',
      ),
      (deviceId) => ({ type: 'select-mic', deviceId }),
    ),
  toggle_guide: (options) =>
    control({
      type: 'set-guide-volume',
      volume: options.guideVolume > 0 ? 0 : GUIDE_TOGGLE_VOLUME,
    }),
};

/** One screen action as one request on the queue link, or nothing if it cannot apply. */
const toRequest = (command: RemoteCommand, options: PlaybackOptions | undefined): Request => {
  if (isCycle(command)) {
    return options === undefined ? null : CYCLE_REQUESTS[command.action](options);
  }
  if (command.action === 'seek') {
    return control({ type: 'seek', positionMs: command.position_ms });
  }
  if (command.action === 'set_guide_volume') {
    return control({ type: 'set-guide-volume', volume: command.volume });
  }
  if (command.action === 'shift_lyrics') {
    return control({ type: 'shift-lyrics', deltaMs: command.delta_ms });
  }
  return SIMPLE_REQUESTS[command.action];
};

const runRequest = async (request: Exclude<Request, null>): Promise<void> => {
  switch (request.kind) {
    case 'command':
      await requestPlaybackCommand(request.command);
      return;
    case 'control':
      await requestPlaybackControl(request.control);
      return;
    case 'random':
      await requestRandomPlayback();
  }
};

/** Status changes are pushed; the page mirrors them into the query cache. */
function usePlaybackStatusMirror() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: PLAYBACK_STATUS, queryFn: loadPlaybackStatus });

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void onPlaybackStatusChanged((next) => {
      queryClient.setQueryData(PLAYBACK_STATUS, next);
    }).then((fn) => {
      if (cancelled) {
        fn();
        return undefined;
      }
      unlisten = fn;
      return undefined;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [queryClient]);

  return status;
}

export function useRemoteClient(): RemoteClient {
  const status = usePlaybackStatusMirror();
  const { progress, options } = useRemotePlayback();
  const [denial, setDenial] = useState<string | null>(null);
  const { mutate } = useMutation({
    mutationFn: runRequest,
    onError: (error: unknown) => setDenial(errorMessage(error)),
  });

  useEffect(() => {
    if (denial === null) {
      return undefined;
    }
    const timer = setTimeout(() => setDenial(null), DENIAL_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [denial]);

  const send = useCallback(
    (command: RemoteCommand) => {
      const request = toRequest(command, options);
      if (request !== null) {
        mutate(request);
      }
    },
    [mutate, options],
  );

  // Memoized on the published objects: the position extrapolator treats a new
  // snapshot as a new baseline, so identity must change only when the host speaks.
  const snapshot = useMemo(
    () =>
      progress?.active === true && options !== undefined ? toSnapshot(progress, options) : null,
    [progress, options],
  );

  let connection: RemoteConnectionState = 'connecting';
  if (status.isError) {
    connection = 'unavailable';
  } else if (status.isSuccess) {
    connection = 'open';
  }

  return useMemo(
    () => ({ snapshot, connection, denial, send }),
    [snapshot, connection, denial, send],
  );
}
