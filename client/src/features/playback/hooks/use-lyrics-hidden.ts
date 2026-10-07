import { atom, useAtom } from 'jotai';

// Whether the lyrics overlay is hidden during playback. Session-scoped (not
// persisted): toggled with the `L` shortcut, read by the lyrics display.
const lyricsHiddenAtom = atom(false);

export const useLyricsHidden = () => useAtom(lyricsHiddenAtom);
