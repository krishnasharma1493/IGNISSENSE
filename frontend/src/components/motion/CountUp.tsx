import { useLayoutEffect, useRef } from 'react';
import { prefersReducedMotion } from './motion';

interface CountUpProps {
  value: number;
  decimals?: number;
  suffix?: string;
  duration?: number;
}

const format = (n: number, decimals: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/**
 * A number that counts up from zero the first time it appears.
 *
 * Only the first appearance animates. These figures refetch every 15–60 s, and
 * a total that re-counted on every refetch would be unreadable, so later
 * changes render immediately.
 *
 * Inside a scroll-reveal container the count waits until that container is
 * revealed, so it plays while the number is visible rather than while its card
 * is still transparent.
 *
 * Frames are written straight to the text node React rendered, so counting
 * costs no React renders. The final text is always React's own output.
 */
export default function CountUp({ value, decimals = 0, suffix = '', duration = 900 }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const played = useRef(false);
  const text = format(value, decimals) + suffix;

  useLayoutEffect(() => {
    const el = ref.current;
    const node = el?.firstChild;
    if (!el || !node) return undefined;
    if (played.current || value === 0 || prefersReducedMotion()) {
      played.current = true;
      node.nodeValue = text;
      return undefined;
    }

    played.current = true;
    let done = false;
    let raf = 0;
    let timer = 0;
    let watcher: MutationObserver | null = null;

    const run = () => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - t) ** 3;
        node.nodeValue = format(value * eased, decimals) + suffix;
        if (t < 1) raf = requestAnimationFrame(tick);
        else done = true;
      };
      raf = requestAnimationFrame(tick);
    };

    node.nodeValue = format(0, decimals) + suffix;

    const host = el.closest<HTMLElement>('[data-reveal]');
    if (host && !host.dataset.revealed) {
      watcher = new MutationObserver(() => {
        if (!host.dataset.revealed) return;
        watcher?.disconnect();
        watcher = null;
        // Start with the card's own staggered fade, not before it.
        const delay = parseFloat(host.style.getPropertyValue('--reveal-delay')) || 0;
        timer = window.setTimeout(run, delay);
      });
      watcher.observe(host, { attributes: true, attributeFilter: ['data-revealed'] });
    } else {
      run();
    }

    return () => {
      watcher?.disconnect();
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      node.nodeValue = text;
      // An interrupted first count (StrictMode's simulated remount, or a value
      // that changed mid-count) has not really been seen yet.
      if (!done) played.current = false;
    };
  }, [value, decimals, suffix, duration, text]);

  return <span ref={ref}>{text}</span>;
}
