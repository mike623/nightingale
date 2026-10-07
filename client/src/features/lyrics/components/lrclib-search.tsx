import { Loader2Icon, SearchIcon, XIcon } from 'lucide-react';
import { type KeyboardEvent, type Ref } from 'react';

import { formatSeconds } from '@/features/lyrics/utils/edit-lyrics';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { cn } from '@/shared/utils/cn';

import { ARIA_DISABLED_CLASS, ringFor } from './parts';

/**
 * Focusables this panel contributes, in DOM order: track, clear track, artist,
 * clear artist, search.
 */
export const LRCLIB_SEARCH_SLOTS = 5;

export type SearchField = 'track' | 'artist';

type LrclibSearchProps = {
  durationSecs: number;
  track: string;
  artist: string;
  trackChips: readonly string[];
  artistChips: readonly string[];
  onTrackChange: (value: string) => void;
  onArtistChange: (value: string) => void;
  onSearch: () => void;
  loading: boolean;
  trackRef: Ref<HTMLInputElement>;
  artistRef: Ref<HTMLInputElement>;
  isFocused: (slot: number) => boolean;
  onFocusSlot: (slot: number) => void;
  isChipFocused: (field: SearchField, index: number) => boolean;
  onFocusChip: (field: SearchField, index: number) => void;
};

export const LrclibSearch = ({
  durationSecs,
  track,
  artist,
  trackChips,
  artistChips,
  onTrackChange,
  onArtistChange,
  onSearch,
  loading,
  trackRef,
  artistRef,
  isFocused,
  onFocusSlot,
  isChipFocused,
  onFocusChip,
}: LrclibSearchProps) => {
  const canSearch = track.trim().length > 0 && !loading;

  const searchOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      onSearch();
    }
  };

  // Kept mounted while the field is empty so the nav slots below stay put.
  const clearButton = (
    field: SearchField,
    slot: number,
    value: string,
    onChange: (next: string) => void,
  ) => (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      onClick={() => onChange('')}
      onFocus={() => onFocusSlot(slot)}
      onPointerDown={() => onFocusSlot(slot)}
      aria-disabled={value.length === 0}
      aria-label={`Clear ${field}`}
      className={cn('shrink-0', ARIA_DISABLED_CLASS, ringFor(isFocused(slot)))}
    >
      <XIcon />
    </Button>
  );

  const chipRow = (field: SearchField, words: readonly string[], onPick: (word: string) => void) =>
    words.length === 0 ? null : (
      <div className="flex flex-wrap gap-1">
        {words.map((word, index) => (
          <Button
            key={word}
            type="button"
            size="sm"
            variant="secondary"
            aria-label={`Use "${word}" as ${field}`}
            onClick={() => onPick(word)}
            onFocus={() => onFocusChip(field, index)}
            onPointerDown={() => onFocusChip(field, index)}
            className={cn('h-6 px-2 text-xs font-normal', ringFor(isChipFocused(field, index)))}
          >
            {word}
          </Button>
        ))}
      </div>
    );

  return (
    <>
      {/* Song length, so the user can pick the match whose duration lines up. */}
      <p className="text-xs text-muted-foreground">
        Song length: <span className="tabular-nums">{formatSeconds(durationSecs)}</span>
      </p>
      {/* The auto-derived title/artist — especially a raw YouTube video name —
          is often wrong, so the lookup has to be repeatable by hand. */}
      <div className="flex items-center gap-2">
        <Input
          ref={trackRef}
          value={track}
          placeholder="Track"
          aria-label="Track"
          onChange={(event) => onTrackChange(event.target.value)}
          onKeyDown={searchOnEnter}
          onFocus={() => onFocusSlot(0)}
          className={cn('flex-1', ringFor(isFocused(0)))}
        />
        {clearButton('track', 1, track, onTrackChange)}
        <Input
          ref={artistRef}
          value={artist}
          placeholder="Artist"
          aria-label="Artist"
          onChange={(event) => onArtistChange(event.target.value)}
          onKeyDown={searchOnEnter}
          onFocus={() => onFocusSlot(2)}
          className={cn('flex-1', ringFor(isFocused(2)))}
        />
        {clearButton('artist', 3, artist, onArtistChange)}
        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={onSearch}
          onFocus={() => onFocusSlot(4)}
          onPointerDown={() => onFocusSlot(4)}
          aria-disabled={!canSearch}
          aria-label="Search LRCLIB"
          className={cn(ARIA_DISABLED_CLASS, ringFor(isFocused(4)))}
        >
          {loading ? <Loader2Icon className="animate-spin" /> : <SearchIcon />}
        </Button>
      </div>
      {chipRow('track', trackChips, onTrackChange)}
      {chipRow('artist', artistChips, onArtistChange)}
    </>
  );
};
