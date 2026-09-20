import { z } from 'zod';

import type { RemoteStatus } from '@/types/RemoteStatus';

/**
 * Wire shapes for the remote-control relay. Every frame a phone receives was
 * written by another client on the network and only fanned out by the relay,
 * so nothing here may be trusted before it parses. Callers use `safeParse` and
 * drop what fails rather than throwing into the UI.
 *
 * Field names are the relay's own snake_case and must not be renamed.
 */

const remoteSongSchema = z.object({
  file_hash: z.string(),
  title: z.string(),
  artist: z.string(),
});

export const remoteSnapshotSchema = z.object({
  song: remoteSongSchema.nullable(),
  paused: z.boolean(),
  position_ms: z.number(),
  duration_ms: z.number(),
  guide_volume: z.number(),
  guide_available: z.boolean(),
  lyrics_hidden: z.boolean(),
  theme_index: z.number(),
  theme_name: z.string(),
  flavor_name: z.string(),
  score: z.number(),
  mic_enabled: z.boolean(),
  mic_monitor_enabled: z.boolean(),
  mic_name: z.string().nullable(),
  can_skip_intro: z.boolean(),
  can_skip_outro: z.boolean(),
});

/** `null` while the host has nothing playing. */
export const remoteStateSchema = remoteSnapshotSchema.nullable();

export const remoteSessionSchema = z.object({
  you: z.number(),
  host_connected: z.boolean(),
});

export const remoteDenySchema = z.object({
  reason: z.enum(['no-host']),
});

/**
 * A command relayed from a phone. The host validates it for the same reason a
 * phone validates a snapshot: the relay fans frames out, it does not vouch for
 * them. Arms without fields carry no payload to check beyond the action name.
 */
export const remoteCommandSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pause') }),
  z.object({ action: z.literal('resume') }),
  z.object({ action: z.literal('toggle_pause') }),
  z.object({ action: z.literal('restart') }),
  z.object({ action: z.literal('next') }),
  z.object({ action: z.literal('exit') }),
  z.object({ action: z.literal('toggle_guide') }),
  z.object({ action: z.literal('cycle_theme') }),
  z.object({ action: z.literal('cycle_flavor') }),
  z.object({ action: z.literal('toggle_lyrics') }),
  z.object({ action: z.literal('toggle_mic') }),
  z.object({ action: z.literal('cycle_mic') }),
  z.object({ action: z.literal('toggle_mic_monitor') }),
  z.object({ action: z.literal('skip_intro') }),
  z.object({ action: z.literal('skip_outro') }),
  z.object({ action: z.literal('seek'), position_ms: z.number().finite().min(0) }),
  z.object({ action: z.literal('set_guide_volume'), volume: z.number().finite().min(0).max(1) }),
]);

/** Result of the desktop `remote_status` command. */
export const remoteStatusSchema: z.ZodType<RemoteStatus> = z.object({
  running: z.boolean(),
  port: z.number().nullable(),
  lan_url: z.string().nullable(),
  ws_url: z.string().nullable(),
});

/** Server-to-client envelope shared with the `/ws` multiplexer. */
export const remoteEnvelopeSchema = z.object({
  type: z.string(),
  payload: z.unknown(),
});

export type RemoteCommand = z.infer<typeof remoteCommandSchema>;
export type RemoteSong = z.infer<typeof remoteSongSchema>;
export type RemoteSnapshot = z.infer<typeof remoteSnapshotSchema>;
export type RemoteSession = z.infer<typeof remoteSessionSchema>;
export type RemoteDeny = z.infer<typeof remoteDenySchema>;
