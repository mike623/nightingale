import { useCallback, useEffect } from 'react';

import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useNavInput } from '@/features/menu/hooks/use-nav-input';
import { usePlaybackCommandDeps } from '@/features/playback/hooks/use-playback-command-deps';
import {
  dispatchPlaybackCommand,
  resolveSkipCommand,
  type PlaybackCommand,
} from '@/features/playback/lib/playback-commands';
import type { AppConfig } from '@/types/AppConfig';

/** How far `+` / `-` move the guide volume per press. */
const GUIDE_VOLUME_STEP = 0.1;

const LETTER_COMMANDS = new Map<string, PlaybackCommand>([
  ['t', { action: 'cycle_theme' }],
  ['f', { action: 'cycle_flavor' }],
  ['m', { action: 'toggle_mic' }],
  ['n', { action: 'cycle_mic' }],
  ['r', { action: 'toggle_mic_monitor' }],
  ['l', { action: 'toggle_lyrics' }],
]);

/** The command a key press asks for, or `null` for keys playback ignores. */
function commandForKey(key: string, guideVolume: number): PlaybackCommand | null {
  switch (key) {
    case ' ':
      return { action: 'toggle_pause' };
    case 'g':
    case 'G':
      return { action: 'toggle_guide' };
    case '=':
    case '+':
      return { action: 'set_guide_volume', volume: guideVolume + GUIDE_VOLUME_STEP };
    case '-':
      return { action: 'set_guide_volume', volume: guideVolume - GUIDE_VOLUME_STEP };
    case 'ArrowRight':
      return { action: 'next' };
    default:
      return LETTER_COMMANDS.get(key.toLowerCase()) ?? null;
  }
}

/**
 * Wires keyboard + gamepad input for the playback session: it gathers the
 * command dependencies from the playback contexts, maps input to a
 * `PlaybackCommand`, and dispatches it. The app config is passed in so guide
 * volume can be persisted without coupling this hook to the config query, and
 * `playNext` because song selection belongs to the route, not the session.
 */
export function usePlaybackInput(config: AppConfig | null, playNext: () => void) {
  const deps = usePlaybackCommandDeps(config, playNext);

  // A dialog opened from the pause overlay (lyrics editor) owns input while it
  // is up: its own controls handle confirm/back, and typing must not reach the
  // playback shortcuts.
  const { mode } = useDialog();
  const dialogOpen = mode !== null;

  // Gamepad: nav.back = pause/resume, nav.confirm = skip intro/outro
  useNavInput(
    useCallback(
      (action) => {
        if (dialogOpen) {
          return;
        }

        if (action.back) {
          dispatchPlaybackCommand({ action: 'toggle_pause' }, deps);
          return;
        }

        if (action.confirm) {
          const command = resolveSkipCommand(deps);
          if (command !== null) {
            dispatchPlaybackCommand(command, deps);
          }
        }
      },
      [deps, dialogOpen],
    ),
  );

  // Keyboard-only shortcuts (G, T, F, M, N, R, L, +/-, Space, ArrowRight)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (dialogOpen) {
        return;
      }

      const command = commandForKey(event.key, deps.guideVolume);
      if (command === null) {
        return;
      }

      const ran = dispatchPlaybackCommand(command, deps);
      // Space always consumes the key; ArrowRight only when it really started
      // the next song, so a blocked press still scrolls as the browser wants.
      if (ran && (command.action === 'toggle_pause' || command.action === 'next')) {
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deps, dialogOpen]);
}
