import { Loader2Icon } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import { searchLrclibTerms } from '@/bridge/lyrics';
import { openUrl } from '@/bridge/opener';
import { useLyricsEditor } from '@/features/lyrics/hooks/use-lyrics-editor';
import { useLyricsifyWindow } from '@/features/lyrics/hooks/use-lyricsify-window';
import { useSaveLyricsMutation } from '@/features/lyrics/mutations/use-save-lyrics-mutation';
import {
  useApplyTimedLyricsMutation,
  useClearLyricsMutation,
  useProvideLrcMutation,
} from '@/features/lyrics/mutations/use-timed-lyrics-mutation';
import { useLrclibCandidates } from '@/features/lyrics/queries/use-lyrics';
import {
  detectLrcLevel,
  isEditLyricsDialogMode,
  shiftLrcTimestamps,
  stripLrcToPlainLines,
} from '@/features/lyrics/utils/edit-lyrics';
import { SHIFT_SLOTS, shiftStepAt } from '@/features/lyrics/utils/lrc-shift';
import { lyricsifySearchUrl } from '@/features/lyrics/utils/lyricsify';
import { useDialog } from '@/features/menu/hooks/use-dialog';
import { useDialogNav } from '@/features/menu/hooks/use-dialog-nav';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { wordChips } from '@/shared/utils/word-chips';
import type { LrclibCandidate } from '@/types/LrclibCandidate';
import type { Song } from '@/types/Song';

import { CarouselNav } from './carousel-nav';
import { EditLyricsFooter } from './edit-lyrics-footer';
import { LrcOptions, type TimingChoice } from './lrc-options';
import { LrcShift } from './lrc-shift';
import { LrclibMatches } from './lrclib-matches';
import { LRCLIB_SEARCH_SLOTS, LrclibSearch, type SearchField } from './lrclib-search';
import { LyricsEditor } from './lyrics-editor';
import { LyricsifyWeb } from './lyricsify-web';
import { ringFor } from './parts';

export { isEditLyricsDialogMode } from '@/features/lyrics/utils/edit-lyrics';

const LRC_SPEC_URL = 'https://en.wikipedia.org/wiki/LRC_(file_format)';

/** Placeholder the library writes when a song carries no artist metadata. */
const UNKNOWN_ARTIST = 'Unknown Artist';

type EditLyricsTab = 'edit' | 'lrclib' | 'web';
const EDIT_LYRICS_TABS = ['edit', 'lrclib', 'web'] satisfies readonly EditLyricsTab[];

const TAB_LABELS: Readonly<Record<EditLyricsTab, string>> = {
  edit: 'Edit',
  lrclib: 'LRCLIB matches',
  web: 'Lyricsify',
};

const isEditLyricsTab = (value: string): value is EditLyricsTab =>
  EDIT_LYRICS_TABS.some((tab) => tab === value);

const editSongState = (song: Song | null) => ({
  fileHash: song?.file_hash ?? null,
  isAnalyzed: song?.is_analyzed ?? false,
  noStems: song?.no_stems ?? false,
});

type NavigationStateInput = {
  candidateCount: number;
  matchesLoading: boolean;
  currentHasLrc: boolean;
  hasLrc: boolean;
  useProvidedTiming: boolean;
  stemsSeparated: boolean;
  saving: boolean;
};

const navigationState = (input: NavigationStateInput) => ({
  // While a search runs the matches pane shows a spinner instead of the
  // candidate buttons, so their slots have to leave the ring as well.
  hasCandidates: input.candidateCount > 0 && !input.matchesLoading,
  useSlots: input.currentHasLrc ? 2 : 1,
  shiftNav: input.hasLrc && !input.saving,
  timingNav: input.hasLrc && !input.saving,
  audioNav: input.useProvidedTiming && !input.stemsSeparated && !input.saving,
});

const queryError = (error: unknown): Error | null => (error instanceof Error ? error : null);

/** Results of a manual search replace the auto-derived ones while they are set. */
const resolveCandidates = (
  manual: LrclibCandidate[] | null,
  auto: LrclibCandidate[] | undefined,
): LrclibCandidate[] => manual ?? auto ?? [];

/** Once manual results are showing, a stale auto-query failure is irrelevant. */
const autoQueryError = (manual: LrclibCandidate[] | null, error: unknown): Error | null =>
  manual === null ? queryError(error) : null;

const searchFailureMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'LRCLIB search failed.';

type SearchTerms = { track: string; artist: string };

/** Seed the manual boxes with the song's own metadata, minus the placeholder artist. */
const defaultSearchTerms = (song: Song | null): SearchTerms => ({
  track: song?.title ?? '',
  artist: song !== null && song.artist !== UNKNOWN_ARTIST ? song.artist : '',
});

/** The element being typed in, when the DOM focus sits on one of `elements`. */
const activeAmong = (elements: readonly (HTMLElement | null)[]): HTMLElement | null =>
  elements.find((element) => element !== null && document.activeElement === element) ?? null;

const editedSong = (mode: ReturnType<typeof useDialog>['mode']): Song | null =>
  isEditLyricsDialogMode(mode) ? mode.song : null;

type FooterMessageInput = {
  hasLrc: boolean;
  useProvidedTiming: boolean;
  lrcLevel: ReturnType<typeof detectLrcLevel>;
  willSeparate: boolean;
  stemsSeparated: boolean;
};

const footerMessage = (input: FooterMessageInput): string | undefined => {
  const hints: string[] = [];
  if (!input.hasLrc) {
    hints.push('Paste LRC / Enhanced LRC to set timing directly.');
  }
  if (input.useProvidedTiming && input.lrcLevel === 'line') {
    hints.push('Line-level LRC highlights whole lines — no per-word timing.');
  }
  if (input.hasLrc && input.useProvidedTiming && !input.willSeparate && !input.stemsSeparated) {
    hints.push('Original mix is used, so pitch scoring will likely be inaccurate.');
  }

  return hints.length > 0 ? hints.join(' ') : undefined;
};

type TimingMetaInput = {
  hasLrc: boolean;
  timingChoice: TimingChoice;
  isAnalyzed: boolean;
  noStems: boolean;
  separateStems: boolean;
};

const timingMeta = (input: TimingMetaInput) => {
  const useProvidedTiming = input.hasLrc && input.timingChoice === 'provided';
  const stemsSeparated = input.isAnalyzed && !input.noStems;
  return {
    useProvidedTiming,
    stemsSeparated,
    willSeparate: useProvidedTiming && input.separateStems && !stemsSeparated,
  };
};

const canSaveLyrics = (
  saving: boolean,
  loading: boolean,
  changedOrReanalyzing: boolean,
  text: string,
): boolean => !saving && !loading && changedOrReanalyzing && text.trim().length > 0;

const hasSyncedLyrics = (candidate: LrclibCandidate | undefined): boolean =>
  typeof candidate?.synced_lyrics === 'string';

const selectedCandidate = (
  candidates: readonly LrclibCandidate[],
  index: number,
): LrclibCandidate | undefined => candidates.at(Math.min(index, candidates.length - 1));

const getSaveLabel = (
  useProvidedTiming: boolean,
  willSeparate: boolean,
  isAnalyzed: boolean,
): string => {
  if (useProvidedTiming) {
    if (willSeparate) {
      return 'Save & separate stems';
    }
    return isAnalyzed ? 'Use timed lyrics' : 'Save timed lyrics';
  }
  return isAnalyzed ? 'Save & realign' : 'Save & analyze';
};

type NavLayout = {
  stops: number[];
  editorSegment: number | null;
  // Top "header row" containing the tab triggers and, on the LRCLIB tab, the
  // carousel arrows after them — all in the same segment so left/right walks
  // across them.
  headerSegment: number | null;
  // Slot offset where the carousel arrows start inside `headerSegment`; null
  // if no arrows in this view.
  arrowSlotStart: number | null;
  // Track / artist inputs plus the search button on the LRCLIB pane.
  searchSegment: number | null;
  // One-click word chips under each search input, present only while the
  // matching field holds more than one word.
  trackChipsSegment: number | null;
  artistChipsSegment: number | null;
  // "Open in browser" on the Lyricsify pane.
  webSegment: number | null;
  // Timestamp offset buttons on the edit pane, present only while the text
  // carries LRC timing.
  shiftSegment: number | null;
  // Timing / audio radio rows (each 2 slots) on the edit pane, present only
  // when their controls are enabled.
  timingSegment: number | null;
  audioSegment: number | null;
  useThisSegment: number | null;
  footerSegment: number;
};

type NavLayoutInput = {
  activeTab: EditLyricsTab;
  hasCandidates: boolean;
  shiftNav: boolean;
  // Number of action buttons on the current LRCLIB candidate: 2 when it has
  // synced lyrics ("Use LRC" + "Use as plain text"), otherwise 1.
  useSlots: number;
  timingNav: boolean;
  audioNav: boolean;
  trackChipCount: number;
  artistChipCount: number;
};

type NavSegment = { key: string; width: number };

type LrclibSegmentsInput = {
  hasCandidates: boolean;
  useSlots: number;
  trackChipCount: number;
  artistChipCount: number;
};

/** Rows under the LRCLIB tab header, in DOM order. */
function lrclibSegments(input: LrclibSegmentsInput): NavSegment[] {
  const segments: NavSegment[] = [{ key: 'search', width: LRCLIB_SEARCH_SLOTS }];

  if (input.trackChipCount > 0) {
    segments.push({ key: 'trackChips', width: input.trackChipCount });
  }
  if (input.artistChipCount > 0) {
    segments.push({ key: 'artistChips', width: input.artistChipCount });
  }
  if (input.hasCandidates) {
    segments.push({ key: 'use', width: Math.max(1, input.useSlots) });
  }

  return segments;
}

function navLayout({
  activeTab,
  hasCandidates,
  useSlots,
  shiftNav,
  timingNav,
  audioNav,
  trackChipCount,
  artistChipCount,
}: NavLayoutInput): NavLayout {
  const onLrclib = activeTab === 'lrclib';
  const tabCount = EDIT_LYRICS_TABS.length;
  const segments: NavSegment[] = [];
  let arrowSlotStart: number | null = null;

  if (onLrclib && hasCandidates) {
    segments.push({ key: 'header', width: tabCount + 2 });
    arrowSlotStart = tabCount;
  } else {
    segments.push({ key: 'header', width: tabCount });
  }

  if (onLrclib) {
    segments.push(...lrclibSegments({ hasCandidates, useSlots, trackChipCount, artistChipCount }));
  } else if (activeTab === 'web') {
    segments.push({ key: 'web', width: 1 });
  } else {
    segments.push({ key: 'editor', width: 1 });
    if (shiftNav) {
      segments.push({ key: 'shift', width: SHIFT_SLOTS });
    }
    if (timingNav) {
      segments.push({ key: 'timing', width: 2 });
    }
    if (audioNav) {
      segments.push({ key: 'audio', width: 2 });
    }
  }

  segments.push({ key: 'footer', width: 2 });

  const indexOf = (key: string): number | null => {
    const i = segments.findIndex((s) => s.key === key);
    return i === -1 ? null : i;
  };

  return {
    stops: segments.map((s) => s.width),
    headerSegment: indexOf('header'),
    arrowSlotStart,
    searchSegment: indexOf('search'),
    trackChipsSegment: indexOf('trackChips'),
    artistChipsSegment: indexOf('artistChips'),
    webSegment: indexOf('web'),
    editorSegment: indexOf('editor'),
    shiftSegment: indexOf('shift'),
    timingSegment: indexOf('timing'),
    audioSegment: indexOf('audio'),
    useThisSegment: indexOf('use'),
    footerSegment: indexOf('footer') ?? segments.length - 1,
  };
}

type EditLyricsWorkspaceProps = {
  activeTab: EditLyricsTab;
  setActiveTab: (tab: EditLyricsTab) => void;
  focusTab: (slot: number) => void;
  headerSegment: number | null;
  arrowSlotStart: number | null;
  isFocused: (segment: number, slot?: number) => boolean;
  matchesLoading: boolean;
  candidateCount: number;
  carouselIndex: number;
  setCarouselIndex: (index: number) => void;
  editorPane: ReactNode;
  searchPane: ReactNode;
  webPane: ReactNode;
  candidates: LrclibCandidate[];
  matchesError: Error | null;
  useThisSegment: number | null;
  onSelect: (candidate: LrclibCandidate) => void;
  onUseLrc: (candidate: LrclibCandidate) => void;
};

const EditLyricsWorkspace = (props: EditLyricsWorkspaceProps) => {
  return (
    <Tabs
      value={props.activeTab}
      onValueChange={(value) => {
        if (isEditLyricsTab(value)) {
          props.setActiveTab(value);
        }
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex items-center justify-between gap-2">
        <TabsList>
          {EDIT_LYRICS_TABS.map((tab, slot) => (
            <TabsTrigger
              key={tab}
              value={tab}
              onMouseEnter={() => props.focusTab(slot)}
              onPointerDown={() => props.focusTab(slot)}
              onFocus={() => props.focusTab(slot)}
              className={ringFor(
                props.headerSegment !== null && props.isFocused(props.headerSegment, slot),
              )}
            >
              {TAB_LABELS[tab]}
              {tab === 'lrclib' &&
                (props.matchesLoading ? (
                  <Loader2Icon className="size-3 animate-spin" />
                ) : (
                  `(${props.candidateCount})`
                ))}
            </TabsTrigger>
          ))}
        </TabsList>
        {props.activeTab === 'lrclib' &&
          props.headerSegment !== null &&
          props.arrowSlotStart !== null && (
            <CarouselNav
              index={props.carouselIndex}
              total={props.candidateCount}
              onChange={props.setCarouselIndex}
              isFocused={(slot) =>
                props.isFocused(props.headerSegment ?? 0, (props.arrowSlotStart ?? 0) + slot)
              }
            />
          )}
      </div>
      <TabsContent value="edit" className="mt-3 flex min-h-0 flex-1 flex-col">
        {props.editorPane}
      </TabsContent>
      <TabsContent value="web" className="mt-3 flex min-h-0 flex-1 flex-col">
        {props.webPane}
      </TabsContent>
      <TabsContent value="lrclib" className="mt-3 flex min-h-0 flex-1 flex-col gap-2">
        {props.searchPane}
        <LrclibMatches
          candidates={props.candidates}
          isLoading={props.matchesLoading}
          isError={props.matchesError !== null}
          errorMessage={props.matchesError?.message ?? null}
          index={props.carouselIndex}
          onSelect={props.onSelect}
          onUseLrc={props.onUseLrc}
          isFocused={(slot) =>
            props.useThisSegment !== null && props.isFocused(props.useThisSegment, slot)
          }
        />
      </TabsContent>
    </Tabs>
  );
};

export const EditLyricsDialog = () => {
  const { mode, close } = useDialog();
  const song = editedSong(mode);
  const open = song !== null;
  const { fileHash, isAnalyzed, noStems } = editSongState(song);

  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const trackRef = useRef<HTMLInputElement>(null);
  const artistRef = useRef<HTMLInputElement>(null);

  const editor = useLyricsEditor({ song, onSaved: close });
  const candidatesQuery = useLrclibCandidates(fileHash);
  // A manual LRCLIB search (custom track / artist) overrides the auto results.
  const [manualResults, setManualResults] = useState<LrclibCandidate[] | null>(null);
  const [manualLoading, setManualLoading] = useState(false);
  const [searchTrack, setSearchTrack] = useState(() => defaultSearchTerms(song).track);
  const [searchArtist, setSearchArtist] = useState(() => defaultSearchTerms(song).artist);
  const trackChips = useMemo(() => wordChips(searchTrack), [searchTrack]);
  const artistChips = useMemo(() => wordChips(searchArtist), [searchArtist]);
  const candidates = resolveCandidates(manualResults, candidatesQuery.data);
  const candidateCount = candidates.length;
  const matchesLoading = [candidatesQuery.isLoading, manualLoading].some(Boolean);

  const provideLrcMutation = useProvideLrcMutation();
  const applyTimedMutation = useApplyTimedLyricsMutation();
  const saveLyricsMutation = useSaveLyricsMutation();
  const clearLyricsMutation = useClearLyricsMutation();

  const [activeTab, setActiveTab] = useState<EditLyricsTab>('edit');
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [timingChoice, setTimingChoice] = useState<TimingChoice>('provided');
  const [separateStems, setSeparateStems] = useState(false);
  const [lastHash, setLastHash] = useState<string | null>(fileHash);
  if (lastHash !== fileHash) {
    const terms = defaultSearchTerms(song);
    setLastHash(fileHash);
    setActiveTab('edit');
    setCarouselIndex(0);
    setTimingChoice('provided');
    setSeparateStems(false);
    setManualResults(null);
    setManualLoading(false);
    setSearchTrack(terms.track);
    setSearchArtist(terms.artist);
  }

  const runManualSearch = async (): Promise<void> => {
    const track = searchTrack.trim();
    if (manualLoading || track.length === 0) {
      return;
    }
    setManualLoading(true);
    try {
      const results = await searchLrclibTerms(track, searchArtist.trim());
      setManualResults(results);
      setCarouselIndex(0);
      if (results.length === 0) {
        toast.info('No LRCLIB matches for those terms.');
      }
    } catch (error) {
      toast.error(searchFailureMessage(error));
    } finally {
      setManualLoading(false);
    }
  };

  const lrcLevel = useMemo(() => detectLrcLevel(editor.text), [editor.text]);
  const hasLrc = lrcLevel !== 'none';
  const { useProvidedTiming, stemsSeparated, willSeparate } = timingMeta({
    hasLrc,
    timingChoice,
    isAnalyzed,
    noStems,
    separateStems,
  });

  const saving = [
    provideLrcMutation.isLoading,
    applyTimedMutation.isLoading,
    saveLyricsMutation.isLoading,
    clearLyricsMutation.isLoading,
  ].some(Boolean);
  const canSave = canSaveLyrics(
    saving,
    editor.loadingInitial,
    editor.isDirty || (isAnalyzed && !useProvidedTiming),
    editor.text,
  );

  const saveLabel = getSaveLabel(useProvidedTiming, willSeparate, isAnalyzed);

  const footerHint = footerMessage({
    hasLrc,
    useProvidedTiming,
    lrcLevel,
    willSeparate,
    stemsSeparated,
  });

  const handleSave = () => {
    if (!canSave || !song) {
      return;
    }
    const hash = song.file_hash;
    const title = song.title;

    if (useProvidedTiming) {
      if (willSeparate) {
        provideLrcMutation.mutate(
          { hash, lrcText: editor.text, separateStems: true, title },
          { onSuccess: close },
        );
      } else if (isAnalyzed) {
        applyTimedMutation.mutate({ hash, lrcText: editor.text, title }, { onSuccess: close });
      } else {
        provideLrcMutation.mutate(
          { hash, lrcText: editor.text, separateStems: false, title },
          { onSuccess: close },
        );
      }
      return;
    }

    const lines = hasLrc ? stripLrcToPlainLines(editor.text) : editor.normalized;
    if (lines.length === 0) {
      return;
    }
    saveLyricsMutation.mutate({ hash, lines, title }, { onSuccess: close });
  };

  const handleDelete = () => {
    if (saving || song === null) {
      return;
    }
    clearLyricsMutation.mutate({ hash: song.file_hash, title: song.title }, { onSuccess: close });
  };

  const applyCandidate = (candidate: LrclibCandidate) => {
    editor.setText(candidate.lines.join('\n'));
    setTimingChoice('provided');
    setActiveTab('edit');
  };

  const applyCandidateLrc = (candidate: LrclibCandidate) => {
    if (candidate.synced_lyrics === null) {
      return;
    }
    editor.setText(candidate.synced_lyrics);
    setTimingChoice('provided');
    setActiveTab('edit');
  };

  // The Lyricsify tab opens straight on this song's search results.
  const lyricsifyUrl = lyricsifySearchUrl(searchTrack, searchArtist);
  const applyCopiedLyrics = (text: string) => {
    if (editor.isDirty) {
      toast.info('Lyrics copied \u2014 paste them into the Edit tab to keep your changes.');
      return;
    }

    editor.setText(text);
    setTimingChoice('provided');
    setActiveTab('edit');
    toast.success('Pasted the lyrics you copied from Lyricsify.');
  };

  const { openLyricsify } = useLyricsifyWindow({
    dialogOpen: open,
    onWebTab: activeTab === 'web',
    url: lyricsifyUrl,
    onLyrics: applyCopiedLyrics,
  });

  const currentCandidate = selectedCandidate(candidates, carouselIndex);
  const nav = navigationState({
    candidateCount,
    matchesLoading,
    currentHasLrc: hasSyncedLyrics(currentCandidate),
    hasLrc,
    useProvidedTiming,
    stemsSeparated,
    saving,
  });

  const layout = navLayout({
    activeTab,
    ...nav,
    trackChipCount: trackChips.length,
    artistChipCount: artistChips.length,
  });

  const { isFocused, focusSegment } = useDialogNav({
    open,
    itemCount: layout.stops.reduce((sum, n) => sum + n, 0),
    stops: layout.stops,
    onBack: close,
    containerRef,
    onAction: (segment, slot, action) => {
      const handleHeader = (): boolean => {
        if (layout.headerSegment === null || segment !== layout.headerSegment) {
          return false;
        }
        const tab = slot < EDIT_LYRICS_TABS.length ? EDIT_LYRICS_TABS.at(slot) : undefined;
        if (tab !== undefined) {
          setActiveTab(tab);
          return true;
        }
        if (layout.arrowSlotStart !== null && slot >= layout.arrowSlotStart) {
          const delta = slot === layout.arrowSlotStart ? -1 : 1;
          setCarouselIndex((index) =>
            Math.min(Math.max(0, index + delta), Math.max(0, candidateCount - 1)),
          );
        }
        return true;
      };

      const handleSearch = (): boolean => {
        if (layout.searchSegment === null || segment !== layout.searchSegment) {
          return false;
        }
        if (slot === 0) {
          trackRef.current?.focus();
        } else if (slot === 1) {
          setSearchTrack('');
        } else if (slot === 2) {
          artistRef.current?.focus();
        } else if (slot === 3) {
          setSearchArtist('');
        } else {
          void runManualSearch();
        }
        return true;
      };

      const handleChips = (): boolean => {
        if (layout.trackChipsSegment !== null && segment === layout.trackChipsSegment) {
          const word = trackChips.at(slot);
          if (word !== undefined) {
            setSearchTrack(word);
          }
          return true;
        }
        if (layout.artistChipsSegment !== null && segment === layout.artistChipsSegment) {
          const word = artistChips.at(slot);
          if (word !== undefined) {
            setSearchArtist(word);
          }
          return true;
        }
        return false;
      };

      const handleWeb = (): boolean => {
        if (layout.webSegment === null || segment !== layout.webSegment) {
          return false;
        }
        openLyricsify();
        return true;
      };

      // Shift / timing / audio rows all sit under the editor on the edit pane.
      const handleOption = (): boolean => {
        if (layout.shiftSegment !== null && segment === layout.shiftSegment) {
          const step = shiftStepAt(slot);
          if (step !== undefined) {
            editor.setText(shiftLrcTimestamps(editor.text, step));
          }
          return true;
        }
        if (layout.timingSegment !== null && segment === layout.timingSegment) {
          setTimingChoice(slot === 0 ? 'provided' : 'align');
          return true;
        }
        if (layout.audioSegment !== null && segment === layout.audioSegment) {
          setSeparateStems(slot === 1);
          return true;
        }
        return false;
      };

      const handleCandidate = (): boolean => {
        if (layout.useThisSegment === null || segment !== layout.useThisSegment) {
          return false;
        }
        const candidate = selectedCandidate(candidates, carouselIndex);
        if (candidate && hasSyncedLyrics(candidate) && slot === 0) {
          applyCandidateLrc(candidate);
        } else if (candidate) {
          applyCandidate(candidate);
        }
        return true;
      };

      const handleFooter = (): boolean => {
        if (segment !== layout.footerSegment) {
          return false;
        }
        if (slot === 0 && !saving) {
          close();
        } else if (slot !== 0) {
          handleSave();
        }
        return true;
      };

      const editing = activeAmong([textareaRef.current, trackRef.current, artistRef.current]);

      if (editing !== null) {
        if (action.back) {
          editing.blur();
        }
        return true;
      }

      if (!action.confirm) {
        return false;
      }

      if (layout.editorSegment !== null && segment === layout.editorSegment) {
        textareaRef.current?.focus();
        return true;
      }

      for (const handler of [
        handleHeader,
        handleSearch,
        handleChips,
        handleWeb,
        handleOption,
        handleCandidate,
        handleFooter,
      ]) {
        if (handler()) {
          return true;
        }
      }
      return false;
    },
  });

  if (!song) {
    return null;
  }

  const editorFocused = layout.editorSegment !== null && isFocused(layout.editorSegment);
  const focusTab = (slot: number) => {
    if (layout.headerSegment !== null) {
      focusSegment(layout.headerSegment, slot);
    }
  };

  const focusedSlotIn = (segment: number | null, slots = 2): number | null => {
    if (segment === null) {
      return null;
    }
    for (let slot = 0; slot < slots; slot++) {
      if (isFocused(segment, slot)) {
        return slot;
      }
    }
    return null;
  };

  const carouselHeaderSegment = layout.headerSegment;
  const carouselArrowSlotStart = layout.arrowSlotStart;

  const chipSegment = (field: SearchField): number | null =>
    field === 'track' ? layout.trackChipsSegment : layout.artistChipsSegment;

  const searchPane = (
    <LrclibSearch
      durationSecs={song.duration_secs}
      track={searchTrack}
      artist={searchArtist}
      trackChips={trackChips}
      artistChips={artistChips}
      onTrackChange={setSearchTrack}
      onArtistChange={setSearchArtist}
      onSearch={() => {
        void runManualSearch();
      }}
      loading={manualLoading}
      trackRef={trackRef}
      artistRef={artistRef}
      isFocused={(slot) => layout.searchSegment !== null && isFocused(layout.searchSegment, slot)}
      onFocusSlot={(slot) => {
        if (layout.searchSegment !== null) {
          focusSegment(layout.searchSegment, slot);
        }
      }}
      isChipFocused={(field, index) => {
        const segment = chipSegment(field);
        return segment !== null && isFocused(segment, index);
      }}
      onFocusChip={(field, index) => {
        const segment = chipSegment(field);
        if (segment !== null) {
          focusSegment(segment, index);
        }
      }}
    />
  );

  const webPane = (
    <LyricsifyWeb
      onOpen={openLyricsify}
      focused={layout.webSegment !== null && isFocused(layout.webSegment)}
    />
  );

  const editorPane = (
    <>
      <LyricsEditor
        textareaRef={textareaRef}
        text={editor.text}
        onChange={editor.setText}
        disabled={editor.loadingInitial || saving}
        loadingInitial={editor.loadingInitial}
        lineCount={editor.normalized.length}
        isDirty={editor.isDirty}
        focused={editorFocused}
      />
      {hasLrc && (
        <LrcShift
          onShift={(seconds) => editor.setText(shiftLrcTimestamps(editor.text, seconds))}
          disabled={saving}
          focusedSlot={focusedSlotIn(layout.shiftSegment, SHIFT_SLOTS)}
          onFocusSlot={(slot) => {
            if (layout.shiftSegment !== null) {
              focusSegment(layout.shiftSegment, slot);
            }
          }}
        />
      )}
      <LrcOptions
        level={lrcLevel}
        stemsSeparated={stemsSeparated}
        timingChoice={timingChoice}
        onTimingChoiceChange={setTimingChoice}
        separateStems={separateStems}
        onSeparateStemsChange={setSeparateStems}
        disabled={saving}
        timingFocusedSlot={focusedSlotIn(layout.timingSegment)}
        audioFocusedSlot={focusedSlotIn(layout.audioSegment)}
        onFocusOption={(row, slot) => {
          const segment = row === 'timing' ? layout.timingSegment : layout.audioSegment;
          if (segment !== null) {
            focusSegment(segment, slot);
          }
        }}
      />
    </>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          close();
        }
      }}
    >
      <DialogContent className="flex h-[85vh] flex-col sm:max-w-2xl">
        <div ref={containerRef} className="contents">
          <DialogHeader>
            <DialogTitle>Edit lyrics</DialogTitle>
            <DialogDescription>
              Type plain lyrics to run alignment, or paste{' '}
              <a
                href={LRC_SPEC_URL}
                rel="noreferrer"
                onClick={(event) => {
                  event.preventDefault();
                  void openUrl(LRC_SPEC_URL);
                }}
                className="text-primary underline underline-offset-2 hover:text-primary/80"
              >
                LRC / Enhanced LRC
              </a>{' '}
              to set timing directly.
            </DialogDescription>
          </DialogHeader>

          <EditLyricsWorkspace
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            focusTab={focusTab}
            headerSegment={carouselHeaderSegment}
            arrowSlotStart={carouselArrowSlotStart}
            isFocused={isFocused}
            matchesLoading={matchesLoading}
            candidateCount={candidateCount}
            carouselIndex={carouselIndex}
            setCarouselIndex={setCarouselIndex}
            editorPane={editorPane}
            searchPane={searchPane}
            webPane={webPane}
            candidates={candidates}
            matchesError={autoQueryError(manualResults, candidatesQuery.error)}
            useThisSegment={layout.useThisSegment}
            onSelect={applyCandidate}
            onUseLrc={applyCandidateLrc}
          />

          <EditLyricsFooter
            onCancel={close}
            onSave={handleSave}
            saving={saving}
            canSave={canSave}
            saveLabel={saveLabel}
            hint={footerHint}
            onDelete={isAnalyzed ? handleDelete : undefined}
            isFocused={(slot) => isFocused(layout.footerSegment, slot)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};
