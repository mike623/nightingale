import { useLayoutEffect, useState } from 'react';

type VirtualRowsInput = {
  /** How many rows the list has, including ones not fetched yet. */
  count: number;
  /** The height of one row, in the same `rem` the rows are styled with. */
  rowHeightRem: number;
  /** Rows kept past each edge of the viewport so a flick does not show gaps. */
  overscan: number;
};

type RowWindow = {
  /** Index of the first row to put in the document. */
  start: number;
  /** Index one past the last row to put in the document. */
  end: number;
};

type VirtualRows = RowWindow & {
  /** Attach to the element that scrolls. */
  scrollRef: (element: HTMLElement | null) => void;
  /** Height the whole list occupies, for the element holding the rows. */
  listHeight: string;
  /** Distance from the top of that element to a row's own top. */
  rowOffset: (index: number) => string;
};

const EMPTY_WINDOW: RowWindow = { start: 0, end: 0 };

const sameWindow = (a: RowWindow, b: RowWindow) => a.start === b.start && a.end === b.end;

/**
 * A window onto a list too long to put in the document: which rows a reader can
 * currently see, and where each of them belongs in the list's full height.
 *
 * Rows are one uniform height, stated in `rem` so the list follows the reader's
 * text size, and placed by the browser rather than by arithmetic here. Their
 * height in pixels is read back from the layout the browser produced, so the
 * two never disagree about which row a scroll offset lands on.
 */
export const useVirtualRows = ({
  count,
  rowHeightRem,
  overscan,
}: VirtualRowsInput): VirtualRows => {
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [rows, setRows] = useState(EMPTY_WINDOW);

  useLayoutEffect(() => {
    if (scroller === null) {
      return undefined;
    }

    const read = () => {
      const rowPx = scroller.scrollHeight / count;
      const first = Math.floor(scroller.scrollTop / rowPx);
      const visible = Math.ceil(scroller.clientHeight / rowPx);
      const next = {
        start: Math.max(0, first - overscan),
        end: Math.min(count, first + visible + overscan),
      };

      // Scrolling within a row changes nothing about what is on screen, so the
      // list re-renders when it moves rather than on every scroll event.
      setRows((previous) => (sameWindow(previous, next) ? previous : next));
    };

    read();
    scroller.addEventListener('scroll', read, { passive: true });

    const observer = new ResizeObserver(read);
    observer.observe(scroller);

    return () => {
      scroller.removeEventListener('scroll', read);
      observer.disconnect();
    };
  }, [count, overscan, scroller]);

  // A shorter list than the one the window was last read against would put rows
  // past its end in the document, so the window never outruns the count it has.
  return {
    start: Math.min(rows.start, count),
    end: Math.min(rows.end, count),
    scrollRef: setScroller,
    listHeight: `${count * rowHeightRem}rem`,
    rowOffset: (index: number) => `${index * rowHeightRem}rem`,
  };
};
