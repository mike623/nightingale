import {
  AlignLeftIcon,
  DownloadIcon,
  AudioLinesIcon,
  FileX2Icon,
  ImageIcon,
  LanguagesIcon,
  MicIcon,
  PencilLineIcon,
  RefreshCwIcon,
  Trash2Icon,
  XCircleIcon,
} from 'lucide-react';

import type { Song } from '@/types/Song';

import type { SongStatusInfo } from '../shared/song-status';
import type { ActionItemProps } from './action-item';

type AnalysisHandler = (fileHash: string) => void | Promise<void>;

type AnalysisHandlers = {
  enqueueOne: AnalysisHandler;
  cancelAnalysisOne: AnalysisHandler;
  deleteSongCache: AnalysisHandler;
  reanalyzeFull: AnalysisHandler;
  reanalyzeTranscript: AnalysisHandler;
  realign: AnalysisHandler;
  reanalyzeForceTranscribe: AnalysisHandler;
  refreshMetadata: (fileHash: string) => Promise<boolean | undefined>;
};

type BuildActionGroupsParams = {
  song: Song;
  status: SongStatusInfo;
  analysisBusy: boolean;
  supportsAnalysisActions: boolean;
  analysis: AnalysisHandlers;
  /** Set only for a song imported from YouTube, which is the only kind that
   * can be fetched again. */
  onRedownload: (() => void) | null;
  onEditLyrics: () => void;
  onChangeLanguage: () => void;
  onDeleteSong: () => void;
  run: (
    message: string,
    action: () => void | boolean | undefined | Promise<void | boolean | undefined>,
    onFalse?: string,
  ) => () => Promise<void>;
};

export function buildActionGroups({
  song,
  status,
  analysisBusy,
  supportsAnalysisActions,
  analysis,
  onRedownload,
  onEditLyrics,
  onChangeLanguage,
  onDeleteSong,
  run,
}: BuildActionGroupsParams): ActionItemProps[][] {
  const groups: ActionItemProps[][] = [];

  const supportsProvideLyrics = song.transcript_source !== 'Usdx';

  if (status.isReady !== true) {
    const notReadyGroup: ActionItemProps[] = [
      analysisBusy
        ? {
            icon: XCircleIcon,
            title: 'Cancel analysis',
            description: 'Stop analysis and remove this song from the queue.',
            destructive: true,
            onClick: run(`Cancelled analysis for "${song.title}"`, () =>
              analysis.cancelAnalysisOne(song.file_hash),
            ),
          }
        : {
            icon: AudioLinesIcon,
            title: 'Analyze song',
            description: 'Prepare lyrics, timing, key, tempo, and stems.',
            onClick: () => analysis.enqueueOne(song.file_hash),
          },
    ];

    if (supportsProvideLyrics) {
      notReadyGroup.push({
        icon: PencilLineIcon,
        title: 'Provide lyrics',
        description: 'Paste timed LRC, or lyrics to align.',
        disabled: analysisBusy,
        onClick: onEditLyrics,
      });
    }

    groups.push(notReadyGroup);
  }

  if (supportsAnalysisActions) {
    // LRC-provided songs have no AI-generated stems/timing to rebuild, so the
    // realign/refetch/transcribe actions don't apply. Offer editing the LRC and
    // an explicit opt-in to replace it with full AI analysis instead.
    if (song.transcript_source === 'Lrc') {
      groups.push([
        {
          icon: PencilLineIcon,
          title: 'Edit lyrics (LRC)',
          description: 'Replace or re-time the provided LRC.',
          onClick: onEditLyrics,
        },
        {
          icon: AudioLinesIcon,
          title: 'Analyze with AI',
          description: 'Replace the LRC with AI stems, lyrics, timing, and key.',
          onClick: run(`Analyzing "${song.title}" with AI`, () =>
            analysis.reanalyzeFull(song.file_hash),
          ),
        },
      ]);
    } else {
      groups.push([
        {
          icon: AlignLeftIcon,
          title: 'Realign',
          description: 'Rebuild timing from the current lyrics.',
          onClick: run(`Realigning "${song.title}"`, () => analysis.realign(song.file_hash)),
        },
        {
          icon: RefreshCwIcon,
          title: 'Refetch lyrics & align',
          description: 'Fetch fresh lyrics, then rebuild timing.',
          onClick: run(`Refetching lyrics & aligning "${song.title}"`, () =>
            analysis.reanalyzeTranscript(song.file_hash),
          ),
        },
        {
          icon: MicIcon,
          title: 'Force transcribe',
          description: 'Ignore online lyrics and transcribe the vocals.',
          onClick: run(`Force transcribing "${song.title}"`, () =>
            analysis.reanalyzeForceTranscribe(song.file_hash),
          ),
        },
        {
          icon: AudioLinesIcon,
          title: 'Full reanalysis',
          description: 'Recreate stems, lyrics, timing, key, and tempo.',
          onClick: run(`Full reanalysis (w/ stems) for "${song.title}"`, () =>
            analysis.reanalyzeFull(song.file_hash),
          ),
        },
      ]);

      groups.push([
        {
          icon: PencilLineIcon,
          title: 'Edit lyrics',
          description: 'Correct the words and rebuild their timing.',
          onClick: onEditLyrics,
        },
        {
          icon: LanguagesIcon,
          title: 'Change language',
          description: 'Set the language and choose how to reprocess.',
          onClick: onChangeLanguage,
        },
      ]);
    }

    if (!song.usdx) {
      groups.push([
        {
          icon: ImageIcon,
          title: 'Refresh metadata',
          description:
            'Reload title, artist, album, duration, and cover art from the library source.',
          onClick: run(
            `Refreshed metadata for "${song.title}"`,
            () => analysis.refreshMetadata(song.file_hash),
            `Nothing to refresh for "${song.title}"`,
          ),
        },
      ]);
    }

    groups.push([
      {
        icon: Trash2Icon,
        title: 'Delete cache',
        description: 'Remove every generated file for this song.',
        destructive: true,
        onClick: run(`Cache deleted for "${song.title}"`, () =>
          analysis.deleteSongCache(song.file_hash),
        ),
      },
    ]);
  }

  if (onRedownload !== null) {
    groups.push([
      {
        icon: DownloadIcon,
        title: 'Re-download video',
        description:
          'Fetch the video from YouTube again, replacing the file. Keeps lyrics, timing, and stems when the new video runs the same length.',
        disabled: analysisBusy,
        onClick: onRedownload,
      },
    ]);
  }

  // Only a song whose bytes we own can be deleted. Remote-origin songs live on
  // someone else's server, so `song.path` is just a local materialisation.
  if (song.origin.kind === 'local_file') {
    groups.push([
      {
        icon: FileX2Icon,
        title: 'Delete song',
        description: 'Permanently delete the file and its generated files.',
        destructive: true,
        disabled: analysisBusy,
        onClick: onDeleteSong,
      },
    ]);
  }

  return groups;
}
