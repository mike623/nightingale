import { readText } from '@tauri-apps/plugin-clipboard-manager';

import { isTauri } from './runtime';

/**
 * Current clipboard text, or `null` when it cannot be read.
 *
 * Browsers reject `navigator.clipboard.readText()` unless the document holds
 * focus, which is never true while the user is reading another window, so the
 * self-hosted build has no equivalent and reports `null` instead.
 */
export const readClipboardText = async (): Promise<string | null> => {
  if (!isTauri) {
    return null;
  }

  return await readText().catch(() => null);
};
