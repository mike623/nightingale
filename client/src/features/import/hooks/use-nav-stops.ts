import { useLayoutEffect, useState, type RefObject } from 'react';

import { DIALOG_FOCUSABLE_SELECTOR } from '@/features/menu/hooks/use-dialog-nav';

/**
 * Collapses the visible, enabled focusables under `container` into nav-ring
 * segments: each focusable inherits a `data-nav-group` from its nearest tagged
 * ancestor, and consecutive focusables sharing a group become one segment.
 */
function readStops(container: HTMLElement): number[] {
  const focusables = Array.from(
    container.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR),
  ).filter((el) => el.offsetWidth > 0 || el.offsetHeight > 0);

  const next: number[] = [];
  let lastGroup: string | null = null;
  for (const el of focusables) {
    const group = el.closest<HTMLElement>('[data-nav-group]')?.dataset.navGroup ?? '';
    // An untagged focusable never merges, so a missed tag costs one extra
    // segment rather than a misaligned ring.
    if (group === '' || group !== lastGroup) {
      next.push(1);
      lastGroup = group === '' ? null : group;
    } else {
      next[next.length - 1] += 1;
    }
  }

  return next.length > 0 ? next : [1];
}

/**
 * Controller/keyboard ring segments for the subtree under `containerRef`.
 *
 * `useDialogNav` requires `stops` to sum to exactly the *visible, enabled*
 * focusables under the container, in DOM order — and half a page's controls
 * disable themselves (Fetch with an empty box, Select all when everything is
 * ticked, Import with nothing ticked), which drops them from
 * `DIALOG_FOCUSABLE_SELECTOR`. Hand-counting segments would silently desync the
 * ring the moment one of those flipped, so the segments are read back off the
 * DOM instead. Adding a control means tagging it, not updating a count.
 *
 * The DOM is the source, so the DOM is what is watched: a branch swapping, rows
 * arriving, or a control toggling `disabled` are all mutations, and each one
 * re-reads the segments. The returned array keeps its identity while the
 * segments are unchanged, so a no-op re-read costs no render.
 */
export function useNavStops(containerRef: RefObject<HTMLElement | null>): number[] {
  const [stops, setStops] = useState<number[]>([1]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      // Nothing is attached yet, so there is nothing to watch or disconnect.
      return undefined;
    }

    const sync = () => {
      const resolved = readStops(container);
      setStops((prev) =>
        prev.length === resolved.length && prev.every((n, i) => n === resolved[i])
          ? prev
          : resolved,
      );
    };

    sync();

    const observer = new MutationObserver(sync);
    observer.observe(container, { attributes: true, childList: true, subtree: true });

    return () => observer.disconnect();
  }, [containerRef]);

  return stops;
}
