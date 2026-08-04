// Remembers the most recently imported YouTube playlist so it can be
// re-imported in one click (delta import pulls only newly added tracks).
// Client-side only — a convenience, not part of the library state.

const KEY = "nightingale:last-playlist";

export interface LastPlaylist {
  url: string;
  title: string;
}

export function saveLastPlaylist(p: LastPlaylist): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // ignore quota / unavailable storage
  }
}

export function readLastPlaylist(): LastPlaylist | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastPlaylist>;
    return parsed.url ? { url: parsed.url, title: parsed.title ?? "" } : null;
  } catch {
    return null;
  }
}
