/**
 * Playback session: audio engine, visual background, lyrics HUD, and pause overlay.
 * Route shell (`Playback`) keys this session so state resets for every queued entry.
 *
 * `PlaybackInner` itself is the provider shell; `PlaybackLayout` is the
 * presentational tree that consumes the playback contexts via hooks.
 */

import type { PlaybackPlayer } from '@/bridge/playback-session';
import { isTauri } from '@/bridge/runtime';
import { EditLyricsDialog, isEditLyricsDialogMode } from '@/features/lyrics/components';
import { useDialog } from '@/features/menu/hooks/use-dialog';
import { Background } from '@/features/playback/components/background';
import { ResultDialog } from '@/features/playback/components/dialogs/result';
import { LoadingScreen } from '@/features/playback/components/loading-screen';
import { LyricsDisplay } from '@/features/playback/components/lyrics-display';
import { PauseOverlay } from '@/features/playback/components/pause-overlay';
import { PitchGraph } from '@/features/playback/components/pitch-graph';
import { PlaybackBar } from '@/features/playback/components/playback-bar';
import { PlaybackHud } from '@/features/playback/components/playback-hud';
import { usePlaybackInput, usePlaybackNext, usePlaybackResult } from '@/features/playback/hooks';
import { usePlaybackHistory } from '@/features/playback/hooks/use-playback-history';
import { useRemoteHost } from '@/features/playback/hooks/use-remote-host';
import {
  PlaybackProviders,
  usePlaybackMicState,
  usePlaybackTranscriptState,
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from '@/features/playback/providers';
import type { AppConfig } from '@/types/AppConfig';
import type { Song } from '@/types/Song';

export type PlaybackInnerProps = {
  song: Song;
  config: AppConfig | null;
  queuePlayback: boolean;
  sessionPlayback: boolean;
  players?: readonly PlaybackPlayer[];
};

type PlaybackLayoutProps = PlaybackInnerProps;

const EMPTY_PLAYERS: readonly PlaybackPlayer[] = [];

function displaySettings(config: AppConfig | null) {
  return {
    lyricsVerticalPosition: config?.lyrics_vertical_position ?? 'bottom',
    lyricsHorizontalPosition: config?.lyrics_horizontal_position ?? 'center',
    lyricsScale: config?.lyrics_scale,
    pitchGraphScale: config?.pitch_graph_scale,
    lyricsRomanizationMode: config?.lyrics_romanization_mode ?? 'enabled',
  };
}

function PlaybackLayout({
  song,
  config,
  queuePlayback,
  sessionPlayback,
  players,
}: PlaybackLayoutProps) {
  const { isReady, paused } = usePlaybackTransportState();
  const { handleContinue, handleExit } = usePlaybackTransportActions();
  const { segments } = usePlaybackTranscriptState();
  const mic = usePlaybackMicState();
  const {
    lyricsVerticalPosition,
    lyricsHorizontalPosition,
    lyricsScale,
    pitchGraphScale,
    lyricsRomanizationMode,
  } = displaySettings(config);
  const hudPosition = lyricsVerticalPosition === 'top' ? 'bottom' : 'top';
  const sessionWindowControls = sessionPlayback && isTauri;

  const next = usePlaybackNext(song.file_hash, players ?? EMPTY_PLAYERS);
  const { playNext } = next;

  const { mode, setMode } = useDialog();
  const editingLyrics = isEditLyricsDialogMode(mode);
  const openLyricsEditor = () => setMode({ mode: 'edit-lyrics', song });

  const result = usePlaybackResult(song, {
    queuePlayback,
    autoPlayNext: config?.auto_play_next === true,
    next,
  });
  usePlaybackInput(config, playNext, !result.open);
  usePlaybackHistory(song.file_hash);
  useRemoteHost(song, config, playNext);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black" style={{ contain: 'strict' }}>
      <Background />

      {isReady ? (
        <>
          <PlaybackBar onNext={playNext} />
          <PlaybackHud
            title={song.title}
            artist={song.artist}
            config={config}
            position={hudPosition}
            windowControls={sessionWindowControls}
          />
          <PitchGraph series={mic.series} position={hudPosition} scale={pitchGraphScale} />
          <LyricsDisplay
            segments={segments}
            verticalPosition={lyricsVerticalPosition}
            horizontalPosition={lyricsHorizontalPosition}
            scale={lyricsScale}
            romanizationMode={lyricsRomanizationMode}
          />
        </>
      ) : (
        <LoadingScreen song={song} />
      )}

      <PauseOverlay
        open={paused && !result.open && !editingLyrics}
        exitLabel={sessionPlayback ? 'Exit Playback' : 'Exit to Menu'}
        onContinue={handleContinue}
        onExit={handleExit}
        onNext={playNext}
        onEditLyrics={openLyricsEditor}
      />

      <EditLyricsDialog />

      <ResultDialog
        open={result.open}
        results={result.results}
        song={song}
        scores={result.scores}
        nextPending={result.nextPending}
        autoNextIn={result.autoNextIn}
        exitLabel={sessionPlayback ? 'Exit Playback' : 'Back to Menu'}
        onBack={result.onBack}
        onNext={result.onNext}
        onStopAutoNext={result.onStopAutoNext}
      />
    </div>
  );
}

export function PlaybackInner({
  song,
  config,
  queuePlayback,
  sessionPlayback,
  players,
}: PlaybackInnerProps) {
  return (
    <PlaybackProviders song={song} config={config} players={players}>
      <PlaybackLayout
        song={song}
        config={config}
        queuePlayback={queuePlayback}
        sessionPlayback={sessionPlayback}
        players={players}
      />
    </PlaybackProviders>
  );
}
