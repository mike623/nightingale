import { useQuery } from '@tanstack/react-query';

import type { PlaybackControl, PlaybackOptions } from '@/bridge/playback-remote';
import { loadRemoteLyrics } from '@/bridge/remote-control';
import { shiftStepLabel, shiftSteps } from '@/features/lyrics/utils/lrc-shift';
import { errorMessage } from '@/features/remote/lib/error-message';
import { TOUCH_TARGET } from '@/features/remote/lib/touch-target';
import { t } from '@/i18n';
import { Button } from '@/shared/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/components/ui/empty';
import { Spinner } from '@/shared/components/ui/spinner';
import { cn } from '@/shared/utils/cn';

const MS_PER_SEC = 1000;
const REMOTE_LYRICS = ['remote-lyrics'];

type Send = (control: PlaybackControl) => void;

const formatOffset = (offsetMs: number): string =>
  `${offsetMs > 0 ? '+' : ''}${(offsetMs / MS_PER_SEC).toFixed(1)}s`;

/**
 * The lyrics editor's shift steps. Here they move only what is on the shared
 * screen, for as long as this song plays; nothing on disk changes.
 */
const ShiftControls = ({ offsetMs, send }: { offsetMs: number; send: Send }) => (
  <fieldset className="space-y-2">
    <legend className="flex w-full items-baseline justify-between gap-3 text-sm font-medium">
      <span>{t('remote.lyrics.shiftTiming')}</span>
      <span className="text-xs tabular-nums text-muted-foreground">{formatOffset(offsetMs)}</span>
    </legend>
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {shiftSteps.map((step) => (
        <Button
          className={cn(TOUCH_TARGET, 'w-full font-mono')}
          key={step}
          onClick={() => send({ type: 'shift-lyrics', deltaMs: step * MS_PER_SEC })}
          type="button"
          variant="outline"
        >
          {shiftStepLabel(step)}
        </Button>
      ))}
    </div>
    <p className="text-xs text-muted-foreground">{t('remote.lyrics.shiftHint')}</p>
  </fieldset>
);

const LyricsLines = ({ fileHash }: { fileHash: string }) => {
  // Keyed by song: lyrics change only when the host replaces them.
  const { data, isLoading, error } = useQuery({
    queryKey: [...REMOTE_LYRICS, fileHash],
    queryFn: loadRemoteLyrics,
  });

  if (isLoading) {
    return (
      <output aria-live="polite" className="flex justify-center py-6">
        <Spinner />
      </output>
    );
  }

  if (error !== null) {
    return (
      <p aria-live="polite" className="text-sm text-destructive">
        {t('remote.lyrics.loadError', { error: errorMessage(error) })}
      </p>
    );
  }

  const lines = data ?? [];
  if (lines.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('remote.lyrics.noLyrics')}</EmptyTitle>
          <EmptyDescription>{t('remote.lyrics.noLyricsDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return <p className="text-sm leading-relaxed whitespace-pre-line">{lines.join('\n')}</p>;
};

type LyricsSectionProps = {
  fileHash: string | null;
  options: PlaybackOptions | undefined;
  send: Send;
};

/**
 * The playing song's words to read along with. Static lines: the shared screen
 * owns the timing, and a phone following it would only add its own lag.
 */
export const LyricsSection = ({ fileHash, options, send }: LyricsSectionProps) => {
  if (fileHash === null) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>{t('remote.lyrics.nothingPlaying')}</EmptyTitle>
          <EmptyDescription>{t('remote.lyrics.nothingPlayingDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <section aria-label={t('remote.tabs.lyrics')} className="min-w-0 space-y-4">
      <Button
        aria-pressed={options?.lyricsHidden === true}
        className={cn(TOUCH_TARGET, 'w-full')}
        onClick={() => send({ type: 'toggle-lyrics' })}
        type="button"
        variant="outline"
      >
        {options?.lyricsHidden === true
          ? t('remote.lyrics.showOnScreen')
          : t('remote.lyrics.hideOnScreen')}
      </Button>
      {options?.lyricShiftAllowed === true && (
        <ShiftControls offsetMs={options.lyricOffsetMs} send={send} />
      )}
      <LyricsLines fileHash={fileHash} />
    </section>
  );
};
