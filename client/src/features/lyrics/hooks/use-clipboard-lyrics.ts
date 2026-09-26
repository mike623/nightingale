/**
 * Reports lyrics copied while an external lyrics site is open.
 *
 * Only text that reads like lyrics is handed back: a stray URL or password
 * copied during the visit never reaches the editor.
 */

import { useClipboardWatch } from '@/shared/hooks/use-clipboard-watch';

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
  useClipboardWatch({
    active,
    read: (text) => (looksLikeLyrics(text) ? text : null),
    onCopy: onLyrics,
  });
}
