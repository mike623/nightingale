/**
 * Owns the Lyricsify browser window the editor's web tab opens, and the
 * clipboard handoff that ends the visit.
 */

import { useState } from 'react';

import { closeBrowserWindow, openBrowserWindow } from '@/bridge/opener';
import { useClipboardLyrics } from '@/features/lyrics/hooks/use-clipboard-lyrics';

const WINDOW_LABEL = 'lyricsify';

export type UseLyricsifyWindowArgs = {
  /** Whether the lyrics editor itself is open. */
  dialogOpen: boolean;
  /** Whether the web tab is the one on screen. */
  onWebTab: boolean;
  url: string;
  onLyrics: (text: string) => void;
};

export function useLyricsifyWindow({
  dialogOpen,
  onWebTab,
  url,
  onLyrics,
}: UseLyricsifyWindowArgs): { openLyricsify: () => void } {
  const [windowOpen, setWindowOpen] = useState(false);

  // Copying lyrics on the site is the signal that the visit is done.
  useClipboardLyrics({
    active: dialogOpen && windowOpen && onWebTab,
    onLyrics: (text) => {
      setWindowOpen(false);
      void closeBrowserWindow(WINDOW_LABEL);
      onLyrics(text);
    },
  });

  const openLyricsify = () => {
    setWindowOpen(true);
    void openBrowserWindow(WINDOW_LABEL, url);
  };

  return { openLyricsify };
}
