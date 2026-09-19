/**
 * Owns the YouTube browser window the import page opens, and the clipboard
 * handoff that fills the URL box from it.
 *
 * The window is a top-level one rather than an iframe because YouTube refuses
 * to be framed. It stays open after a link arrives — browsing usually means
 * collecting several — and only the focus comes back to the application.
 */

import { useEffect, useState } from 'react';

import { closeBrowserWindow, openBrowserWindow } from '@/bridge/opener';
import { focusAppWindow } from '@/bridge/window';
import { extractYoutubeUrl } from '@/features/import/lib/youtube-url';
import { useClipboardWatch } from '@/shared/hooks/use-clipboard-watch';

const WINDOW_LABEL = 'youtube-import';

const YOUTUBE_URL = 'https://www.youtube.com';

export type UseYoutubeWindowArgs = {
  /** Whether the URL box is the view on screen. */
  active: boolean;
  onUrl: (url: string) => void;
};

export function useYoutubeWindow({ active, onUrl }: UseYoutubeWindowArgs): {
  openYoutube: () => void;
} {
  const [windowOpen, setWindowOpen] = useState(false);

  // Copying a link on the site is the signal that one was picked.
  useClipboardWatch({
    active: active && windowOpen,
    read: extractYoutubeUrl,
    onCopy: (url) => {
      onUrl(url);
      void focusAppWindow();
    },
  });

  // Leaving the import page takes the window with it, so nothing is orphaned.
  useEffect(
    () => () => {
      void closeBrowserWindow(WINDOW_LABEL);
    },
    [],
  );

  const openYoutube = () => {
    setWindowOpen(true);
    void openBrowserWindow(WINDOW_LABEL, YOUTUBE_URL);
  };

  return { openYoutube };
}
