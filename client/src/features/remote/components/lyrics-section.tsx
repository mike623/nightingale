import type { RemoteCommand, RemoteSnapshot } from '@/bridge/remote';
import { shiftStepLabel, shiftSteps } from '@/features/lyrics/utils/lrc-shift';
import { errorMessage } from '@/features/remote/lib/error-message';
import { TOUCH_TARGET } from '@/features/remote/lib/touch-target';
import { usePartyLyrics } from '@/features/remote/queries/use-party';
import { Button } from '@/shared/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/shared/components/ui/empty';
import { Spinner } from '@/shared/components/ui/spinner';
import { cn } from '@/shared/utils/cn';

const MS_PER_SEC = 1000;

type ShiftControlsProps = {
  offsetMs: number;
  disabled: boolean;
  send: (command: RemoteCommand) => void;
};

/**
 * The same steps the desktop lyrics editor shifts by, so a room that has used
 * one has used the other. Here they move only what is on the screen everyone
 * is watching, for as long as this song plays.
 */
const ShiftControls = ({ offsetMs, disabled, send }: ShiftControlsProps) => (
  <fieldset className="space-y-2">
    <legend className="flex w-full items-baseline justify-between gap-3 text-sm font-medium">
      <span>Shift timing</span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {offsetMs > 0 ? '+' : ''}
        {(offsetMs / MS_PER_SEC).toFixed(1)}s
      </span>
    </legend>

    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      {shiftSteps.map((step) => (
        <Button
          className={cn(TOUCH_TARGET, 'w-full font-mono')}
          disabled={disabled}
          key={step}
          onClick={() => send({ action: 'shift_lyrics', delta_ms: step * MS_PER_SEC })}
          type="button"
          variant="outline"
        >
          {shiftStepLabel(step)}
        </Button>
      ))}
    </div>

    <p className="text-xs text-muted-foreground">
      Moves the words on the screen, not the song. Later is positive, and the song starts again on
      its own timing.
    </p>
  </fieldset>
);

type SongLyricsProps = {
  fileHash: string;
  offsetMs: number;
  locked: boolean;
  send: (command: RemoteCommand) => void;
};

const SongLyrics = ({ fileHash, offsetMs, locked, send }: SongLyricsProps) => {
  const { data, isLoading, error } = usePartyLyrics(fileHash);

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
        The lyrics could not be read: {errorMessage(error)}
      </p>
    );
  }

  const lines = data?.lines ?? [];

  return (
    <section aria-label="Lyrics" className="min-w-0 space-y-4">
      {data?.shift_allowed === true && (
        <ShiftControls disabled={locked} offsetMs={offsetMs} send={send} />
      )}

      {lines.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No lyrics yet</EmptyTitle>
            <EmptyDescription>
              This song has no words stored on the host to read along with.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <p className="text-sm leading-relaxed whitespace-pre-line">{lines.join('\n')}</p>
      )}
    </section>
  );
};

type LyricsSectionProps = {
  snapshot: RemoteSnapshot | null;
  locked: boolean;
  send: (command: RemoteCommand) => void;
};

/**
 * The playing song's words, to read along with on a phone. The lines are
 * static: the screen everyone is watching owns the timing, and a phone that
 * tried to follow it would only disagree with the room by its own lag.
 */
export const LyricsSection = ({ snapshot, locked, send }: LyricsSectionProps) => {
  const fileHash = snapshot?.song?.file_hash ?? null;

  if (fileHash === null) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Nothing is playing</EmptyTitle>
          <EmptyDescription>The words appear once a song starts.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <SongLyrics
      fileHash={fileHash}
      locked={locked}
      offsetMs={snapshot?.lyric_offset_ms ?? 0}
      send={send}
    />
  );
};
