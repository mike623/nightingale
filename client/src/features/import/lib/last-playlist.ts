// Remembers the most recently imported YouTube playlist so it can be
// re-imported in one click (delta import pulls only newly added tracks).
// Client-side only — a convenience, not part of the library state.

const KEY = 'nightingale:last-playlist';

export type LastPlaylist = {
  url: string;
  title: string;
};

export function saveLastPlaylist(p: LastPlaylist): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // ignore quota / unavailable storage
  }
}

/**
 * localStorage is user-writable and survives releases, so the stored payload
 * is untrusted: validate its shape rather than asserting one onto it.
 */
function parseLastPlaylist(raw: string): LastPlaylist | null {
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  if (!('url' in parsed) || typeof parsed.url !== 'string' || parsed.url === '') {
    return null;
  }

  const title = 'title' in parsed && typeof parsed.title === 'string' ? parsed.title : '';

  return { url: parsed.url, title };
}

export function readLastPlaylist(): LastPlaylist | null {
  try {
    const raw = localStorage.getItem(KEY);

    return raw === null || raw === '' ? null : parseLastPlaylist(raw);
  } catch {
    return null;
  }
}
