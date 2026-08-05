import type { LrclibCandidate } from "@/types/LrclibCandidate";
import type { LyricsFile } from "@/types/LyricsFile";
import { invoke } from "./runtime";

export const loadLyrics = async (fileHash: string): Promise<LyricsFile | null> => {
  return await invoke<LyricsFile | null>("load_lyrics", { fileHash });
};

export const searchLrclibLyrics = async (fileHash: string): Promise<LrclibCandidate[]> => {
  return await invoke<LrclibCandidate[]>("search_lrclib_lyrics", { fileHash });
};

/** Manual LRCLIB search with user-supplied track/artist terms. */
export const searchLrclibTerms = async (
  track: string,
  artist: string,
): Promise<LrclibCandidate[]> => {
  return await invoke<LrclibCandidate[]>("search_lrclib_terms", { track, artist });
};

export const saveLyrics = async (fileHash: string, lines: string[]): Promise<void> => {
  return await invoke<void>("save_lyrics", { fileHash, lines });
};

export const provideLrc = async (
  fileHash: string,
  lrcText: string,
  separateStems: boolean,
): Promise<void> => {
  return await invoke<void>("provide_lrc", { fileHash, lrcText, separateStems });
};

export const applyTimedLyrics = async (fileHash: string, lrcText: string): Promise<void> => {
  return await invoke<void>("apply_timed_lyrics", { fileHash, lrcText });
};

/** Remove a song's lyrics entirely, leaving it lyricless but still playable. */
export const clearLyrics = async (fileHash: string): Promise<void> => {
  return await invoke<void>("clear_lyrics", { fileHash });
};
