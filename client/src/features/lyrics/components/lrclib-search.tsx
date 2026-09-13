import { Loader2Icon, SearchIcon } from 'lucide-react';
import { type KeyboardEvent, type Ref } from 'react';

import { formatSeconds } from '@/features/lyrics/utils/edit-lyrics';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { cn } from '@/shared/utils/cn';

import { ARIA_DISABLED_CLASS, ringFor } from './parts';

/** Focusables this panel contributes, in DOM order: track, artist, search. */
export const LRCLIB_SEARCH_SLOTS = 3;

type LrclibSearchProps = {
  durationSecs: number;
  track: string;
  artist: string;
  onTrackChange: (value: string) => void;
  onArtistChange: (value: string) => void;
  onSearch: () => void;
  loading: boolean;
  trackRef: Ref<HTMLInputElement>;
  artistRef: Ref<HTMLInputElement>;
  isFocused: (slot: number) => boolean;
  onFocusSlot: (slot: number) => void;
};

export const LrclibSearch = ({
  durationSecs,
  track,
  artist,
  onTrackChange,
  onArtistChange,
  onSearch,
  loading,
  trackRef,
  artistRef,
  isFocused,
  onFocusSlot,
}: LrclibSearchProps) => {
  const canSearch = track.trim().length > 0 && !loading;

  const searchOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      onSearch();
    }
  };

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
        <Input
          ref={artistRef}
          value={artist}
          placeholder="Artist"
          aria-label="Artist"
          onChange={(event) => onArtistChange(event.target.value)}
          onKeyDown={searchOnEnter}
          onFocus={() => onFocusSlot(1)}
          className={cn('flex-1', ringFor(isFocused(1)))}
        />
        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={onSearch}
          onFocus={() => onFocusSlot(2)}
          onPointerDown={() => onFocusSlot(2)}
          aria-disabled={!canSearch}
          aria-label="Search LRCLIB"
          className={cn(ARIA_DISABLED_CLASS, ringFor(isFocused(2)))}
        >
          {loading ? <Loader2Icon className="animate-spin" /> : <SearchIcon />}
        </Button>
      </div>
    </>
  );
};
