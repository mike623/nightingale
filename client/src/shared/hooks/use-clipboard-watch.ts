/**
 * Watches the clipboard while an external window is open, so coming back to
 * the application is not a manual paste.
 *
 * Polling only runs while `active` is set. The clipboard is read into memory,
 * mapped by `read`, and dropped: text `read` rejects is never reported,
 * stored, or logged, so copying a password in the meantime does nothing.
 */

import { useEffect, useRef } from 'react';

import { readClipboardText } from '@/bridge/clipboard';

const POLL_INTERVAL_MS = 700;

export type UseClipboardWatchArgs<T> = {
  active: boolean;
  /** Maps clipboard text to the value worth reporting, or `null` to ignore it. */
  read: (text: string) => T | null;
  onCopy: (value: T) => void;
};

export function useClipboardWatch<T>({ active, read, onCopy }: UseClipboardWatchArgs<T>): void {
  // Keeps the interval from restarting whenever the caller re-renders.
  const readRef = useRef(read);
  const onCopyRef = useRef(onCopy);
  useEffect(() => {
    readRef.current = read;
    onCopyRef.current = onCopy;
  }, [read, onCopy]);

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
        // the window opened, so pre-existing content never counts as a copy.
        if (baseline === null) {
          baseline = text;
          return;
        }

        if (text === baseline) {
          return;
        }

        const value = readRef.current(text);
        if (value !== null) {
          baseline = text;
          onCopyRef.current(value);
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
