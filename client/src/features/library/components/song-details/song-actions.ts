import {
  AlignLeftIcon,
  DownloadIcon,
  FolderOpenIcon,
  AudioLinesIcon,
  FileX2Icon,
  ImageIcon,
  LanguagesIcon,
  MicIcon,
  PackageIcon,
  PencilLineIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  Trash2Icon,
  XCircleIcon,
  YoutubeIcon,
} from 'lucide-react';

import { FILE_MANAGER_NAME } from '@/bridge/platform';
import { t } from '@/i18n';
import type { Song } from '@/types/Song';

import type { SongStatusInfo } from '../song/song-status';
import type { ActionItemProps } from './action-item';

function bundleActionCaps(
  song: Song,
  status: SongStatusInfo,
): { canExport: boolean; canViewLyrics: boolean } {
  const isNge = song.path.toLowerCase().endsWith('.nge');
  const ready = status.isReady === true;
  return {
    canExport: ready && !isNge,
    canViewLyrics: ready && isNge,
  };
}

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
  /** Set only for a song imported from YouTube. Both actions are handles on
   * the video it came from, so they arrive and disappear together. */
  youtube: { onRedownload: () => void; onOpen: () => void } | null;
  /** Set only where the file is this machine's to show. */
  onRevealFile: (() => void) | null;
  onEditLyrics: () => void;
  onChangeLanguage: () => void;
  onDeleteSong: () => void;
  onExport: () => void;
  onViewLyrics: () => void;
  run: (
    message: string,
    action: () => void | boolean | undefined | Promise<void | boolean | undefined>,
    onFalse?: string,
  ) => () => Promise<void>;
};

type FileActionParams = Pick<
  BuildActionGroupsParams,
  'song' | 'analysisBusy' | 'youtube' | 'onRevealFile' | 'onDeleteSong'
>;

/** Actions on the song's file itself rather than on its analysis. */
function fileActionGroups({
  song,
  analysisBusy,
  youtube,
  onRevealFile,
  onDeleteSong,
}: FileActionParams): ActionItemProps[][] {
  const groups: ActionItemProps[][] = [];

  if (youtube !== null) {
    groups.push([
      {
        icon: DownloadIcon,
        title: 'library.songDetails.songActions.redownloadVideo',
        description: 'library.songDetails.songActions.redownloadVideoDescription',
        disabled: analysisBusy,
        onClick: youtube.onRedownload,
      },
      {
        icon: YoutubeIcon,
        title: 'library.songDetails.songActions.openOnYoutube',
        description: 'library.songDetails.songActions.openOnYoutubeDescription',
        onClick: youtube.onOpen,
      },
    ]);
  }

  if (onRevealFile !== null) {
    groups.push([
      {
        icon: FolderOpenIcon,
        title: 'library.songDetails.songActions.showInFileManager',
        titleValues: { name: FILE_MANAGER_NAME },
        description: 'library.songDetails.songActions.showInFileManagerDescription',
        onClick: onRevealFile,
      },
    ]);
  }

  // Only a song whose bytes we own can be deleted. Remote-origin songs live on
  // someone else's server, so `song.path` is just a local materialisation.
  if (song.origin.kind === 'local_file') {
    groups.push([
      {
        icon: FileX2Icon,
        title: 'library.songDetails.songActions.deleteSong',
        description: 'library.songDetails.songActions.deleteSongDescription',
        destructive: true,
        disabled: analysisBusy,
        onClick: onDeleteSong,
      },
    ]);
  }

  return groups;
}

export function buildActionGroups({
  song,
  status,
  analysisBusy,
  supportsAnalysisActions,
  analysis,
  youtube,
  onRevealFile,
  onEditLyrics,
  onChangeLanguage,
  onDeleteSong,
  onExport,
  onViewLyrics,
  run,
}: BuildActionGroupsParams): ActionItemProps[][] {
  const groups: ActionItemProps[][] = [];

  const supportsProvideLyrics = song.transcript_source !== 'Usdx';
  const { canExport, canViewLyrics } = bundleActionCaps(song, status);

  if (status.isReady !== true) {
    const notReadyGroup: ActionItemProps[] = [
      analysisBusy
        ? {
            icon: XCircleIcon,
            title: 'library.songDetails.songActions.cancelAnalysis',
            description: 'library.songDetails.songActions.stopAnalysisAndRemoveThisDescription',
            destructive: true,
            onClick: run(t('library.songActions.analysisCancelled', { title: song.title }), () =>
              analysis.cancelAnalysisOne(song.file_hash),
            ),
          }
        : {
            icon: AudioLinesIcon,
            title: 'library.songDetails.songActions.analyzeSong',
            description: 'library.songDetails.songActions.prepareLyricsTimingKeyTempoAndStems',
            onClick: () => analysis.enqueueOne(song.file_hash),
          },
    ];

    if (supportsProvideLyrics) {
      notReadyGroup.push({
        icon: PencilLineIcon,
        title: 'library.songDetails.songActions.provideLyrics',
        description: 'library.songDetails.songActions.pasteTimedLrcOrLyricsToAlign',
        disabled: analysisBusy,
        onClick: onEditLyrics,
      });
    }

    groups.push(notReadyGroup);
  }

  if (canViewLyrics) {
    groups.push([
      {
        icon: ScrollTextIcon,
        title: 'library.songDetails.songActions.viewLyrics',
        description: 'library.songDetails.songActions.showTheLyricsForThisDescription',
        onClick: onViewLyrics,
      },
    ]);
  }

  if (supportsAnalysisActions) {
    // LRC-provided songs have no AI-generated stems/timing to rebuild, so the
    // realign/refetch/transcribe actions don't apply. Offer editing the LRC and
    // an explicit opt-in to replace it with full AI analysis instead.
    if (song.transcript_source === 'Lrc') {
      groups.push([
        {
          icon: PencilLineIcon,
          title: 'library.songDetails.songActions.editLyricsLrc',
          description: 'library.songDetails.songActions.replaceOrReTimeTheProvidedLrc',
          onClick: onEditLyrics,
        },
        {
          icon: AudioLinesIcon,
          title: 'library.songDetails.songActions.analyzeWithAi',
          description: 'library.songDetails.songActions.replaceTheLrcWithAiDescription',
          onClick: run(t('library.songActions.analyzingWithAi', { title: song.title }), () =>
            analysis.reanalyzeFull(song.file_hash),
          ),
        },
      ]);
    } else {
      groups.push([
        {
          icon: AlignLeftIcon,
          title: 'library.songDetails.songActions.realign',
          description: 'library.songDetails.songActions.rebuildTimingFromTheCurrentLyrics',
          onClick: run(t('library.songActions.realigning', { title: song.title }), () =>
            analysis.realign(song.file_hash),
          ),
        },
        {
          icon: RefreshCwIcon,
          title: 'library.songDetails.songActions.refetchLyricsAlign',
          description: 'library.songDetails.songActions.fetchFreshLyricsThenRebuildTiming',
          onClick: run(t('library.songActions.refetchingLyrics', { title: song.title }), () =>
            analysis.reanalyzeTranscript(song.file_hash),
          ),
        },
        {
          icon: MicIcon,
          title: 'library.songDetails.songActions.forceTranscribe',
          description: 'library.songDetails.songActions.ignoreOnlineLyricsAndTranscribeTheVocals',
          onClick: run(t('library.songActions.forceTranscribing', { title: song.title }), () =>
            analysis.reanalyzeForceTranscribe(song.file_hash),
          ),
        },
        {
          icon: AudioLinesIcon,
          title: 'library.songDetails.songActions.fullReanalysis',
          description: 'library.songDetails.songActions.recreateStemsLyricsTimingKeyAndTempo',
          onClick: run(t('library.songActions.fullReanalysis', { title: song.title }), () =>
            analysis.reanalyzeFull(song.file_hash),
          ),
        },
      ]);

      groups.push([
        {
          icon: PencilLineIcon,
          title: 'library.songDetails.songActions.editLyrics',
          description: 'library.songDetails.songActions.correctTheWordsAndRebuildTheirTiming',
          onClick: onEditLyrics,
        },
        {
          icon: LanguagesIcon,
          title: 'library.songDetails.songActions.changeLanguage',
          description: 'library.songDetails.songActions.setTheLanguageAndChooseDescription',
          onClick: onChangeLanguage,
        },
      ]);
    }

    if (!song.usdx) {
      groups.push([
        {
          icon: ImageIcon,
          title: 'library.songDetails.songActions.refreshMetadata',
          description: 'library.songDetails.songActions.reloadTitleArtistAlbumDurationDescription',
          onClick: run(
            t('library.songActions.metadataRefreshed', { title: song.title }),
            () => analysis.refreshMetadata(song.file_hash),
            t('library.songActions.nothingToRefresh', { title: song.title }),
          ),
        },
      ]);
    }

    groups.push([
      {
        icon: Trash2Icon,
        title: 'library.songDetails.songActions.deleteCache',
        description: 'library.songDetails.songActions.removeEveryGeneratedFileForThisSong',
        destructive: true,
        onClick: run(t('library.songActions.cacheDeleted', { title: song.title }), () =>
          analysis.deleteSongCache(song.file_hash),
        ),
      },
    ]);
  }

  if (canExport) {
    groups.push([
      {
        icon: PackageIcon,
        title: 'library.songDetails.songActions.exportNge',
        description: 'library.songDetails.songActions.createASingleFileBundleDescription',
        onClick: onExport,
      },
    ]);
  }

  groups.push(...fileActionGroups({ song, analysisBusy, youtube, onRevealFile, onDeleteSong }));

  return groups;
}
