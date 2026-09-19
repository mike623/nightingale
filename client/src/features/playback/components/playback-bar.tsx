/**
 * Playback bar: elapsed/remaining time, a click-to-seek progress track, and
 * restart/pause/next buttons. Auto-hides after a few idle seconds so it never competes
 * with the lyrics for the bottom of the screen, and comes back on any pointer
 * or key activity (the same reveal behaviour as a video player's chrome).
 *
 * The time text and the progress fill are written straight to the DOM from the
 * transport's rAF subscriber. Routing 30 updates a second through React state
 * would re-render this component on top of a WebGL background for no reason.
 */

import { PauseIcon, RotateCcwIcon, SkipForwardIcon } from 'lucide-react';
import { memo, useEffect, useRef, useState, type MouseEvent } from 'react';

import {
  usePlaybackTransportActions,
  usePlaybackTransportState,
} from '@/features/playback/providers';

const IDLE_HIDE_MS = 3000;

/**
 * Bottom offset that clears the bar. Anything else pinned to the bottom of the
 * playback screen (HUD, pitch graph) positions itself with this, so changing
 * the bar's own padding can't silently start overlapping them.
 */
export const ABOVE_PLAYBACK_BAR_CLASS =
  'bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-[4.5rem]';

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds) % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

const BUTTON_CLASS =
  'pointer-events-auto flex size-9 shrink-0 items-center justify-center rounded-full border border-white/30 bg-black/40 text-white/90 transition-colors hover:bg-black/60';

/** Reveals the bar on activity and hides it again after an idle pause. */
function useRevealOnActivity(): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let timer = window.setTimeout(() => setVisible(false), IDLE_HIDE_MS);

    const reveal = () => {
      setVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setVisible(false), IDLE_HIDE_MS);
    };

    const events = ['mousemove', 'mousedown', 'touchstart', 'keydown'] as const;
    events.forEach((event) => window.addEventListener(event, reveal));

    return () => {
      window.clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, reveal));
    };
  }, []);

  return visible;
}

type PlaybackBarProps = {
  onNext: () => void;
};

function PlaybackBarImpl({ onNext }: PlaybackBarProps) {
  const { duration } = usePlaybackTransportState();
  const { subscribe, getCurrentTime, handlePause, seek } = usePlaybackTransportActions();

  const visible = useRevealOnActivity();
  const timeRef = useRef<HTMLSpanElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const lastSecondRef = useRef(-1);

  useEffect(() => {
    const render = (time: number) => {
      // The fill follows every tick so the bar glides; the text only changes
      // when the displayed second does.
      if (fillRef.current) {
        const ratio = duration > 0 ? Math.min(1, time / duration) : 0;
        fillRef.current.style.transform = `scaleX(${ratio})`;
      }

      const sec = Math.floor(time);
      if (sec !== lastSecondRef.current) {
        lastSecondRef.current = sec;
        if (timeRef.current) {
          timeRef.current.textContent = formatTime(time);
        }
      }
    };

    render(getCurrentTime());

    return subscribe(render);
  }, [subscribe, getCurrentTime, duration]);

  const handleTrackClick = (event: MouseEvent<HTMLDivElement>) => {
    if (duration <= 0) {
      return;
    }
    const { left, width } = event.currentTarget.getBoundingClientRect();
    if (width <= 0) {
      return;
    }
    const ratio = Math.min(1, Math.max(0, (event.clientX - left) / width));
    seek(ratio * duration);
  };

  return (
    <div
      className={`absolute inset-x-0 bottom-0 z-30 flex items-center gap-3 bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-8 transition-opacity duration-300 motion-reduce:transition-none ${
        visible ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
    >
      {/* Restart is the progress track's leftmost seek, as a button. */}
      <button
        type="button"
        className={BUTTON_CLASS}
        onClick={() => seek(0)}
        aria-label="Restart song"
      >
        <RotateCcwIcon className="size-4" />
      </button>

      {/* Pause only: pausing opens the PauseOverlay on top of this bar, and
          resuming is that overlay's Continue action. */}
      <button type="button" className={BUTTON_CLASS} onClick={handlePause} aria-label="Pause">
        <PauseIcon className="size-4" />
      </button>

      <button type="button" className={BUTTON_CLASS} onClick={onNext} aria-label="Next song">
        <SkipForwardIcon className="size-4" />
      </button>

      <span ref={timeRef} className="text-sm tabular-nums text-white/80">
        0:00
      </span>

      {/* The padding is the touch target; the visible track stays 1px tall. */}
      <div
        className="-my-3 min-w-0 flex-1 cursor-pointer py-3"
        onClick={handleTrackClick}
        role="presentation"
      >
        <div className="h-1 overflow-hidden rounded-full bg-white/20">
          <div
            ref={fillRef}
            className="h-full origin-left scale-x-0 rounded-full bg-white/80"
            style={{ willChange: 'transform' }}
          />
        </div>
      </div>

      <span className="text-sm tabular-nums text-white/60">{formatTime(duration)}</span>
    </div>
  );
}

export const PlaybackBar = memo(PlaybackBarImpl);
