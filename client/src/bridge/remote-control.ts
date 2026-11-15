import { z } from 'zod';

import { invoke, isTauri } from './runtime';

const remoteInfoSchema = z.object({
  url: z.string().nullable(),
  qrSvg: z.string().nullable(),
});

export type RemoteInfo = z.infer<typeof remoteInfoSchema>;

const parse = (value: unknown): RemoteInfo => remoteInfoSchema.parse(value);

const interfaceLanguageSchema = z.string().nullable();

/** The host's interface language, so the phone matches the host's choice. */
export const loadInterfaceLanguage = async (): Promise<string | null> =>
  interfaceLanguageSchema.parse(await invoke('load_interface_language'));

/**
 * Describes the LAN queue link for this host. Tauri asks its own local server,
 * the self-hosted build asks the server it is already talking to.
 */
export const loadRemoteInfo = async (): Promise<RemoteInfo> => {
  if (isTauri) {
    return parse(await invoke('remote_control_info'));
  }

  const response = await fetch('/api/remote');
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return parse(await response.json());
};

const remoteLyricsSchema = z.object({ lines: z.array(z.string()) });

/** Words of the song the host is playing; empty while nothing plays. */
export const loadRemoteLyrics = async (): Promise<string[]> =>
  remoteLyricsSchema.parse(await invoke('load_remote_lyrics')).lines;

const remoteImportSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  durationSecs: z.number(),
  status: z.enum(['Draft', 'Queued', 'Downloading', 'Imported', 'Skipped', 'Failed']),
  pct: z.number(),
  problem: z.enum(['unavailable', 'network', 'failed']).nullable(),
});

export type RemoteImport = z.infer<typeof remoteImportSchema>;

/** The host's import queue as a phone may see it. Rejects when imports are off. */
export const loadRemoteImports = async (): Promise<RemoteImport[]> =>
  z.array(remoteImportSchema).parse(await invoke('load_remote_imports'));

export const submitRemoteImport = async (url: string): Promise<RemoteImport> =>
  remoteImportSchema.parse(await invoke('submit_remote_import', { url }));
