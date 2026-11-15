/**
 * Starts a drawn song when a phone asks for one while nothing is playing, so a
 * room with no one at the keyboard can still begin singing.
 */

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';

import { pickNextSong } from '@/bridge/play-history';
import { onRandomPlaybackRequested } from '@/bridge/playback-status';
import { startSong } from '@/features/playback/lib/start-song';
import { t } from '@/i18n';

export function useRandomPlaybackRequests(): void {
  const navigate = useNavigate();
  // Two phones can tap at once, and the draw is a round trip. Without this the
  // room would start two songs and hear the second one.
  const drawingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    const drawAndStart = async (): Promise<void> => {
      // Same weighted draw the playback session uses when its queue is empty.
      const song = await pickNextSong(null);
      if (song === null) {
        toast.info(t('remote.random.noAnalyzedSong'));
        drawingRef.current = false;
        return;
      }
      await startSong(song, navigate);
    };

    void onRandomPlaybackRequested(() => {
      if (drawingRef.current) {
        return;
      }
      drawingRef.current = true;
      void drawAndStart().catch((error: unknown) => {
        drawingRef.current = false;
        toast.error(
          t('remote.random.startFailed', {
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      });
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
  }, [navigate]);
}
