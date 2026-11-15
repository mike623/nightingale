/**
 * The phone page's view of the host, shaped for its screens. Built from what
 * the host publishes on the queue link; nothing here is predicted locally.
 */

export type RemoteSong = {
  file_hash: string;
  title: string;
  artist: string;
};

export type RemoteSnapshot = {
  song: RemoteSong | null;
  paused: boolean;
  /** The host's engine is advancing, so a phone may extrapolate position. */
  playing: boolean;
  position_ms: number;
  duration_ms: number;
  guide_volume: number;
  guide_available: boolean;
  lyrics_hidden: boolean;
  theme_name: string;
  flavor_name: string;
  flavor_available: boolean;
  score: number;
  /** Several singers own their microphones; the per-mic rows do not apply. */
  multiplayer: boolean;
  mic_enabled: boolean;
  mic_monitor_enabled: boolean;
  mic_name: string | null;
  can_skip_intro: boolean;
  can_skip_outro: boolean;
  lyric_offset_ms: number;
  lyric_shift_allowed: boolean;
};

/** Every action a screen on this page can ask the host for. */
export type RemoteCommand =
  | { action: 'pause' }
  | { action: 'resume' }
  | { action: 'restart' }
  | { action: 'next' }
  | { action: 'exit' }
  | { action: 'toggle_guide' }
  | { action: 'cycle_theme' }
  | { action: 'cycle_flavor' }
  | { action: 'toggle_lyrics' }
  | { action: 'toggle_mic' }
  | { action: 'cycle_mic' }
  | { action: 'toggle_mic_monitor' }
  | { action: 'skip_intro' }
  | { action: 'skip_outro' }
  | { action: 'start_random' }
  | { action: 'seek'; position_ms: number }
  | { action: 'set_guide_volume'; volume: number }
  | { action: 'shift_lyrics'; delta_ms: number };

export type RemoteConnectionState = 'connecting' | 'open' | 'unavailable';
