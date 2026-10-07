import type { LogTail } from '@/types/LogTail';
import type { RemoteDiagnostics } from '@/types/RemoteDiagnostics';

import { invoke, isTauri } from './runtime';

/**
 * What the app can tell a user about itself when remote control does not
 * work. Desktop only: the self-hosted server logs to its own output and its
 * operator reads it there, so there is nothing for the browser build to show.
 */
export const DIAGNOSTICS_SUPPORTED = isTauri;

export const readLogTail = async (): Promise<LogTail> => await invoke<LogTail>('read_log');

export const runRemoteDiagnostics = async (): Promise<RemoteDiagnostics> =>
  await invoke<RemoteDiagnostics>('remote_diagnostics');
