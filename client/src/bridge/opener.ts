import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { openUrl as tauriOpenUrl } from '@tauri-apps/plugin-opener';

import { isTauri } from './runtime';

export const openUrl = async (url: string): Promise<void> => {
  if (isTauri) {
    await tauriOpenUrl(url);
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
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
    window.open(url, label, 'noopener,noreferrer,popup,width=1024,height=800');
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
