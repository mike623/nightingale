import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { openUrl as tauriOpenUrl, revealItemInDir } from '@tauri-apps/plugin-opener';

import { isTauri } from './runtime';

/** Handles for browser-build popups, which can only be closed by their opener. */
const popups = new Map<string, Window>();

export const openUrl = async (url: string): Promise<void> => {
  if (isTauri) {
    await tauriOpenUrl(url);
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
};

/**
 * Opens the folder holding `path` in the system file manager, with the file
 * itself selected. Desktop only: the browser build has no filesystem to show.
 */
export const revealPath = async (path: string): Promise<void> => {
  if (!isTauri) {
    return;
  }

  await revealItemInDir(path);
};

/**
 * Shows `url` in a separate application window instead of the system browser.
 *
 * The window is top-level, so sites that refuse to be framed
 * (`X-Frame-Options`, `frame-ancestors`) still render. It carries no
 * capability entry, so the remote page reaches no Tauri command.
 */
export const openBrowserWindow = async (label: string, url: string): Promise<void> => {
  if (!isTauri) {
    const popup = window.open(url, label, 'noopener,noreferrer,popup,width=1024,height=800');
    if (popup !== null) {
      popups.set(label, popup);
    }
    return;
  }

  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    // ponytail: an open window keeps whatever page the user browsed to; Tauri
    // exposes no JS navigation for it. Close and reopen it to force a new URL.
    await existing.show();
    await existing.setFocus();
    return;
  }

  const created = new WebviewWindow(label, { url, width: 1024, height: 800 });
  await new Promise<void>((resolve, reject) => {
    void created.once('tauri://created', () => resolve());
    void created.once<unknown>('tauri://error', ({ payload }) =>
      reject(new Error(String(payload))),
    );
  });
};

/** Closes a window opened by `openBrowserWindow`. A missing window is a no-op. */
export const closeBrowserWindow = async (label: string): Promise<void> => {
  if (!isTauri) {
    popups.get(label)?.close();
    popups.delete(label);
    return;
  }

  const existing = await WebviewWindow.getByLabel(label);
  await existing?.close();
};
