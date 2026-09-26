import { z } from 'zod';

/**
 * The library and queue surface the phone page talks to.
 *
 * Unlike the rest of the bridge this has one implementation: the page always
 * runs in a browser served by the host — the desktop listener or the
 * self-hosted server — so it is always plain HTTP against its own origin.
 *
 * Everything here crosses the network, so every response is parsed before the
 * UI sees it.
 */

const partySongSchema = z.object({
  file_hash: z.string(),
  title: z.string(),
  artist: z.string(),
  album: z.string(),
  duration_secs: z.number(),
  is_analyzed: z.boolean(),
});

const partySongsPageSchema = z.object({
  songs: z.array(partySongSchema),
  total: z.number(),
});

const partyEntrySchema = z.object({
  id: z.string(),
  song: partySongSchema,
});

const partyQueueSchema = z.array(partyEntrySchema);

export type PartySong = z.infer<typeof partySongSchema>;
export type PartyEntry = z.infer<typeof partyEntrySchema>;
export type PartySongsPage = z.infer<typeof partySongsPageSchema>;

const request = async (path: string, init?: RequestInit): Promise<unknown> => {
  const response = await fetch(path, {
    headers: init?.body === undefined ? undefined : { 'content-type': 'application/json' },
    ...init,
  });

  if (!response.ok) {
    throw new Error((await response.text()) || `request failed with ${response.status}`);
  }

  return await response.json();
};

export type PartySongsQuery = {
  search: string;
  skip: number;
  take: number;
};

export const fetchPartySongs = async ({
  search,
  skip,
  take,
}: PartySongsQuery): Promise<PartySongsPage> => {
  const params = new URLSearchParams({ skip: String(skip), take: String(take) });

  if (search.length > 0) {
    params.set('search', search);
  }

  return partySongsPageSchema.parse(await request(`/party/songs?${params.toString()}`));
};

export const fetchPartyQueue = async (): Promise<PartyEntry[]> =>
  partyQueueSchema.parse(await request('/party/queue'));

export const addPartyQueueEntry = async (fileHash: string): Promise<PartyEntry[]> =>
  partyQueueSchema.parse(
    await request('/party/queue', {
      method: 'POST',
      body: JSON.stringify({ file_hash: fileHash }),
    }),
  );

export const reorderPartyQueue = async (id: string, toIndex: number): Promise<PartyEntry[]> =>
  partyQueueSchema.parse(
    await request('/party/queue/reorder', {
      method: 'POST',
      body: JSON.stringify({ id, to_index: toIndex }),
    }),
  );

/**
 * The playing song's words, with whether this host lets a phone move their
 * timing. Lines only: the phone reads along with the screen, it does not run
 * its own clock.
 */
const partyLyricsSchema = z.object({
  lines: z.array(z.string()),
  shift_allowed: z.boolean(),
});

export type PartyLyrics = z.infer<typeof partyLyricsSchema>;

export const fetchPartyLyrics = async (fileHash: string): Promise<PartyLyrics> =>
  partyLyricsSchema.parse(await request(`/party/lyrics/${encodeURIComponent(fileHash)}`));

/** An import as a phone sees it. The host keeps yt-dlp's own words to itself:
 * they quote the paths it was writing to. */
const partyImportSchema = z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  duration_secs: z.number(),
  status: z.enum(['draft', 'queued', 'downloading', 'imported', 'skipped', 'failed']),
  pct: z.number(),
  problem: z.enum(['unavailable', 'network', 'failed']).nullable(),
});

const partyImportsSchema = z.array(partyImportSchema);

export type PartyImport = z.infer<typeof partyImportSchema>;

/** `null` when the host has not turned phone imports on. */
export const fetchPartyImports = async (): Promise<PartyImport[] | null> => {
  const response = await fetch('/party/import');

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error((await response.text()) || `request failed with ${response.status}`);
  }

  return partyImportsSchema.parse(await response.json());
};

export const submitPartyImport = async (url: string): Promise<PartyImport> =>
  partyImportSchema.parse(
    await request('/party/import', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  );

export const removePartyQueueEntry = async (id: string): Promise<PartyEntry[]> =>
  partyQueueSchema.parse(
    await request(`/party/queue/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  );
