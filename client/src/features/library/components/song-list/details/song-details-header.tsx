import { XIcon } from 'lucide-react';

import { Stars } from '@/shared/components/shared/stars';
import { Button } from '@/shared/components/ui/button';
import { formatSeconds } from '@/shared/utils/format-duration';
import { wordChips } from '@/shared/utils/word-chips';
import type { QueuedStatus } from '@/types/QueuedStatus';
import type { Song } from '@/types/Song';

import { AlbumArt } from '../shared/album-art';
import { LanguageBadge, isDisplayableLanguage } from '../shared/language-badge';
import { StatusBadge } from '../shared/status-badge';

export type SongRename = { title?: string; artist?: string };

type SongDetailsHeaderProps = {
  song: Song;
  queueStatus?: QueuedStatus;
  bestScore?: number;
  onClose: () => void;
  onRename: (fields: SongRename) => void;
};

/**
 * Only a song whose bytes and tags we own can be renamed. A media server owns
 * its own metadata — "Refresh metadata" would pull the old name straight back —
 * and a USDX song's name lives in its bundle.
 */
const isRenameable = (song: Song): boolean =>
  song.origin.kind === 'local_file' && song.usdx === null;

type NameChipsProps = {
  label: string;
  value: string;
  onPick: (word: string) => void;
};

/** Trims an imported name down to one of its own words in a single click. */
const NameChips = ({ label, value, onPick }: NameChipsProps) => {
  const words = wordChips(value);
  if (words.length === 0) {
    return null;
  }

  return (
    <div className="mt-1 flex flex-wrap gap-1" data-song-details-nav-group>
      {words.map((word) => (
        <Button
          key={word}
          type="button"
          size="sm"
          variant="secondary"
          aria-label={`Set ${label} to "${word}"`}
          className="h-5 px-1.5 text-[11px] font-normal"
          onClick={() => onPick(word)}
        >
          {word}
        </Button>
      ))}
    </div>
  );
};

export const SongDetailsHeader = ({
  song,
  queueStatus,
  bestScore,
  onClose,
  onRename,
}: SongDetailsHeaderProps) => (
  <header className="relative border-b px-4 pb-4 pt-3">
    <Button
      variant="ghost"
      size="icon-sm"
      className="absolute right-2 top-2"
      onClick={onClose}
      aria-label="Close song details"
    >
      <XIcon />
    </Button>

    <div className="flex items-center gap-3 pr-8">
      <AlbumArt
        song={song}
        className="size-16 rounded-lg"
        fallbackIconClassName="size-6"
        lazy={false}
      />

      <div className="min-w-0 flex-1">
        <h2 className="line-clamp-2 text-sm font-semibold leading-snug text-balance">
          {song.title}
        </h2>
        {isRenameable(song) ? (
          <NameChips label="title" value={song.title} onPick={(title) => onRename({ title })} />
        ) : null}
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {song.artist || 'Unknown band'}
        </p>
        {isRenameable(song) ? (
          <NameChips label="artist" value={song.artist} onPick={(artist) => onRename({ artist })} />
        ) : null}
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {song.album || 'Unknown album'}
        </p>
        {bestScore === undefined ? null : <Stars score={bestScore} size="sm" className="mt-1" />}
      </div>
    </div>

    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <StatusBadge song={song} queueStatus={queueStatus} />
      {isDisplayableLanguage(song.language) ? (
        <>
          <span aria-hidden="true">·</span>
          <LanguageBadge language={song.language} />
        </>
      ) : null}
      <span aria-hidden="true">·</span>
      <span className="tabular-nums">{formatSeconds(song.duration_secs)}</span>
    </div>
  </header>
);
