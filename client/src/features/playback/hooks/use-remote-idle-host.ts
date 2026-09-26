/**
 * Holds the relay's host seat while nothing is playing, so a phone can start a
 * song in a room where no one is at the keyboard.
 *
 * It answers one command. Everything else a phone can send acts on a playing
 * song, and there is none: those belong to `useRemoteHost`, which takes the
 * seat back the moment playback begins and hands it here again when it ends.
 * Nothing is published from here — no snapshot is the truthful report of a
 * host with no song.
 */

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import { pickNextSong } from '@/bridge/play-history';
import { connectRemote, type RemoteCommand } from '@/bridge/remote';
import { startSong } from '@/features/playback/lib/start-song';
import type { AppConfig } from '@/types/AppConfig';

export function useRemoteIdleHost(config: AppConfig | null): void {
  const navigate = useNavigate();
  const enabled = config?.remote_control === true;
  // Two phones can tap at once, and the draw is a round trip. Without this the
  // room would start two songs and hear the second one.
  const drawingRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const drawAndStart = async (): Promise<void> => {
      // The weighted draw is the same one the playback session uses to pick a
      // song when its queue is empty, so a room hears the same selection
      // whoever asked for it.
      const song = await pickNextSong(null);

      if (song === null) {
        // The room is looking at this screen, which is where the phone's tap
        // would otherwise disappear.
        toast.info('No analyzed song to play');
        drawingRef.current = false;
        return;
      }

      await startSong(song, navigate);
    };

    const applyCommand = (command: RemoteCommand): void => {
      if (command.action !== 'start_random' || drawingRef.current) {
        return;
      }

      drawingRef.current = true;

      void drawAndStart().catch((error: unknown) => {
        drawingRef.current = false;
        toast.error(
          `Could not start a song: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
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

    return () => {
      link.close();
    };
  }, [enabled, navigate]);
}
