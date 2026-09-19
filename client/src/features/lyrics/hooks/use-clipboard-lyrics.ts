/**
 * Watches the clipboard for copied lyrics while an external lyrics site is
 * open, so returning to the editor is not a manual paste.
 *
 * Polling only runs while `active` is set. The clipboard is read into memory,
 * compared, and dropped: nothing that fails `looksLikeLyrics` is reported,
 * stored, or logged, so copying a password in the meantime does nothing.
 */

import { useEffect, useRef } from 'react';

import { readClipboardText } from '@/bridge/clipboard';

const POLL_INTERVAL_MS = 700;

/** Copied lyrics run to several lines; a URL or a password does not. */
const MIN_LINES = 3;

/** Guards against pasting a whole page of markup into the editor. */
const MAX_CHARS = 100_000;

const looksLikeLyrics = (text: string): boolean => {
  if (text.length > MAX_CHARS) {
    return false;
  }

  return text.split('\n').filter((line) => line.trim().length > 0).length >= MIN_LINES;
};

export type UseClipboardLyricsArgs = {
  active: boolean;
  onLyrics: (text: string) => void;
};

export function useClipboardLyrics({ active, onLyrics }: UseClipboardLyricsArgs): void {
  // Keeps the interval from restarting whenever the caller re-renders.
  const onLyricsRef = useRef(onLyrics);
  useEffect(() => {
    onLyricsRef.current = onLyrics;
  }, [onLyrics]);

  useEffect(() => {
    if (!active) {
      return undefined;
    }

    let cancelled = false;
    let baseline: string | null = null;
    let reading = false;

    const poll = async () => {
      if (reading) {
        return;
      }
      reading = true;
      try {
        const text = await readClipboardText();
        if (cancelled || text === null) {
          return;
        }

        // The first read establishes what was already on the clipboard before
        // the site opened, so pre-existing content never counts as a copy.
        if (baseline === null) {
          baseline = text;
          return;
        }

        if (text !== baseline && looksLikeLyrics(text)) {
          baseline = text;
          onLyricsRef.current(text);
        }
      } finally {
        reading = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [active]);
}
