/**
 * The named playback commands, and the one implementation behind them.
 *
 * Every control surface (keyboard and gamepad today, remote surfaces later)
 * maps its input to a `PlaybackCommand` and dispatches it here, so no surface
 * can drift from another. The dispatcher takes all of its state and callbacks
 * through `deps`: it reads no context and owns no React state, so a caller in
 * another feature can hand it the same dependencies.
 */

import type { AppConfig } from '@/types/AppConfig';

export type PlaybackCommand =
  | { readonly action: 'pause' }
  | { readonly action: 'resume' }
  | { readonly action: 'toggle_pause' }
  | { readonly action: 'restart' }
  | { readonly action: 'next' }
  | { readonly action: 'exit' }
  | { readonly action: 'seek'; readonly position_ms: number }
  | { readonly action: 'set_guide_volume'; readonly volume: number }
  | { readonly action: 'toggle_guide' }
  | { readonly action: 'cycle_theme' }
  | { readonly action: 'cycle_flavor' }
  | { readonly action: 'toggle_lyrics' }
  | { readonly action: 'toggle_mic' }
  | { readonly action: 'cycle_mic' }
  | { readonly action: 'toggle_mic_monitor' }
  | { readonly action: 'skip_intro' }
  | { readonly action: 'skip_outro' }
  | { readonly action: 'shift_lyrics'; readonly delta_ms: number };

export type PlaybackCommandAction = PlaybackCommand['action'];

export type PlaybackCommandDeps = {
  readonly paused: boolean;
  /** True once the result dialog owns advancing to the next song. */
  readonly nextBlocked: boolean;
  readonly isReady: boolean;
  readonly guideVolume: number;
  readonly guideAvailable: boolean;
  /** Seconds of media time; the first and last lyric boundaries of the song. */
  readonly firstSegmentStart: number;
  readonly lastSegmentEnd: number;
  readonly introSkipLeadSec: number;
  /** Current media position, in seconds. */
  readonly getCurrentTime: () => number;
  /** Transport seek, in seconds of media time. */
  readonly seek: (timeSec: number) => void;
  readonly handlePause: () => void;
  readonly handleContinue: () => void;
  readonly handleExit: () => void;
  readonly playNext: () => void;
  readonly setGuideVolume: (volume: number) => void;
  readonly persistConfig: (patch: Partial<AppConfig>) => void;
  readonly cycleTheme: () => void;
  readonly cycleFlavor: () => void;
  readonly toggleLyricsHidden: () => void;
  readonly handleToggleMic: () => void;
  readonly handleCycleMic: () => void;
  readonly handleToggleMicMonitor: () => void;
  readonly handleSkipIntro: () => void;
  readonly handleSkipOutro: () => void;
  /** Seconds the lyric display currently runs behind the song's own timing. */
  readonly lyricOffsetSec: number;
  readonly setLyricOffsetSec: (seconds: number) => void;
};

const MS_PER_SEC = 1000;

/** Volume `toggle_guide` restores when the guide stem is currently silent. */
const GUIDE_TOGGLE_VOLUME = 0.3;

/** How far past the last lyric the outro skip becomes available, in seconds. */
const OUTRO_SKIP_TAIL_SEC = 1;

/**
 * Furthest the lyric display may be pushed from the song's own timing, in
 * seconds either way. Past this the lines on screen belong to another part of
 * the song, so the offset is a fault rather than a correction.
 */
const MAX_LYRIC_OFFSET_SEC = 10;

/**
 * Commands that still run while playback is paused; every other command is
 * swallowed until playback continues. Only Space reached playback behind the
 * pause overlay: the keyboard handler tested `paused` before its guide-volume
 * branch and short-circuited past it, so the guide keys were swallowed too.
 * The rule lives here so every surface inherits it instead of re-deriving it.
 */
const PAUSED_ACTIONS: ReadonlySet<PlaybackCommandAction> = new Set<PlaybackCommandAction>([
  'pause',
  'resume',
  'toggle_pause',
  // Lining the lyrics up is easiest on a paused song, and moving them changes
  // nothing behind the pause overlay.
  'shift_lyrics',
]);

function clampVolume(volume: number): number {
  return Math.max(0, Math.min(1, volume));
}

/**
 * Guide-volume changes are ignored outright — not applied, not persisted — when
 * the song has no guide stem.
 */
function applyGuideVolume(volume: number, deps: PlaybackCommandDeps): boolean {
  if (!deps.guideAvailable) {
    return false;
  }

  const next = clampVolume(volume);
  deps.setGuideVolume(next);
  deps.persistConfig({ guide_volume: next });
  return true;
}

/** Commands carry milliseconds; the transport seeks in seconds. */
function seekToMs(positionMs: number, deps: PlaybackCommandDeps): boolean {
  if (!Number.isFinite(positionMs)) {
    return false;
  }

  deps.seek(Math.max(0, positionMs) / MS_PER_SEC);
  return true;
}

/**
 * Move the lyric display relative to the song, in milliseconds; positive shows
 * each line later. Only the words on screen move: the audio, the scoring, and
 * the transcript on disk keep the timing they had.
 */
function shiftLyrics(deltaMs: number, deps: PlaybackCommandDeps): boolean {
  if (!Number.isFinite(deltaMs)) {
    return false;
  }

  const next = deps.lyricOffsetSec + deltaMs / MS_PER_SEC;
  deps.setLyricOffsetSec(Math.max(-MAX_LYRIC_OFFSET_SEC, Math.min(MAX_LYRIC_OFFSET_SEC, next)));
  return true;
}

function togglePause(deps: PlaybackCommandDeps): void {
  if (deps.paused) {
    deps.handleContinue();
  } else {
    deps.handlePause();
  }
}

function advanceToNext(deps: PlaybackCommandDeps): boolean {
  if (deps.nextBlocked) {
    return false;
  }

  deps.playNext();
  return true;
}

function canSkipIntro(deps: PlaybackCommandDeps): boolean {
  return deps.isReady && deps.getCurrentTime() < deps.firstSegmentStart - deps.introSkipLeadSec;
}

function canSkipOutro(deps: PlaybackCommandDeps): boolean {
  return deps.isReady && deps.getCurrentTime() > deps.lastSegmentEnd + OUTRO_SKIP_TAIL_SEC;
}

/**
 * Which skip, if either, the current position is eligible for. A surface with a
 * single skip control (the gamepad confirm button) asks here instead of
 * re-deriving the two windows.
 */
export function resolveSkipCommand(deps: PlaybackCommandDeps): PlaybackCommand | null {
  if (canSkipIntro(deps)) {
    return { action: 'skip_intro' };
  }
  if (canSkipOutro(deps)) {
    return { action: 'skip_outro' };
  }
  return null;
}

type NullaryAction = Exclude<PlaybackCommandAction, 'seek' | 'set_guide_volume' | 'shift_lyrics'>;

/** Wraps a command that always takes effect once it passes the paused gate. */
function always(run: (deps: PlaybackCommandDeps) => void): (deps: PlaybackCommandDeps) => boolean {
  return (deps) => {
    run(deps);
    return true;
  };
}

/**
 * One runner per command that carries no payload. Typing the table over the
 * action names makes a missing command a compile error.
 */
const NULLARY_RUNNERS: Readonly<Record<NullaryAction, (deps: PlaybackCommandDeps) => boolean>> = {
  pause: always((deps) => deps.handlePause()),
  resume: always((deps) => deps.handleContinue()),
  toggle_pause: always(togglePause),
  restart: (deps) => seekToMs(0, deps),
  next: advanceToNext,
  exit: always((deps) => deps.handleExit()),
  toggle_guide: (deps) => applyGuideVolume(deps.guideVolume > 0 ? 0 : GUIDE_TOGGLE_VOLUME, deps),
  cycle_theme: always((deps) => deps.cycleTheme()),
  cycle_flavor: always((deps) => deps.cycleFlavor()),
  toggle_lyrics: always((deps) => deps.toggleLyricsHidden()),
  toggle_mic: always((deps) => deps.handleToggleMic()),
  cycle_mic: always((deps) => deps.handleCycleMic()),
  toggle_mic_monitor: always((deps) => deps.handleToggleMicMonitor()),
  skip_intro: (deps) => {
    if (!canSkipIntro(deps)) {
      return false;
    }
    deps.handleSkipIntro();
    return true;
  },
  skip_outro: (deps) => {
    if (!canSkipOutro(deps)) {
      return false;
    }
    deps.handleSkipOutro();
    return true;
  },
};

/**
 * Runs `command` and reports whether it took effect. `false` means the command
 * was ignored: playback is paused and the command is not one of the few allowed
 * there, the next song is blocked, the guide stem is missing, the position is
 * outside the requested skip window, or the seek position is not a number.
 */
export function dispatchPlaybackCommand(
  command: PlaybackCommand,
  deps: PlaybackCommandDeps,
): boolean {
  if (deps.paused && !PAUSED_ACTIONS.has(command.action)) {
    return false;
  }

  if (command.action === 'seek') {
    return seekToMs(command.position_ms, deps);
  }
  if (command.action === 'set_guide_volume') {
    return applyGuideVolume(command.volume, deps);
  }
  if (command.action === 'shift_lyrics') {
    return shiftLyrics(command.delta_ms, deps);
  }

  return NULLARY_RUNNERS[command.action](deps);
}
