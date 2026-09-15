import type { CSSProperties } from 'react';

/**
 * Motion primitives shared by every view. The animation itself lives in
 * index.css ("Motion"); these helpers only decide *when* it plays.
 */

/** True when the viewer asked the OS for reduced motion. Safe outside a browser. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Sets `--i`, which the chart and bar keyframes multiply into their delay. */
export function stagger(i: number, style?: CSSProperties): CSSProperties {
  return { '--i': i, ...style } as CSSProperties;
}

/* ── Scroll reveal ──────────────────────────────────────────────────────────
   One IntersectionObserver for the whole app rather than one per element.
   Elements that come into view in the same callback are revealed as a group,
   and each gets a slightly longer delay than the one before it, so a row of
   cards staggers in without any caller tracking indices. Each element is
   unobserved as soon as it is revealed, so the observer only ever holds
   elements that are still waiting. */

const STAGGER_MS = 45;
const MAX_STEPS = 8;

let observer: IntersectionObserver | null = null;

function getObserver(): IntersectionObserver {
  if (!observer) {
    observer = new IntersectionObserver((entries, obs) => {
      let step = 0;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        el.style.setProperty('--reveal-delay', `${Math.min(step++, MAX_STEPS) * STAGGER_MS}ms`);
        el.dataset.revealed = 'true';
        obs.unobserve(el);
      }
    });
  }
  return observer;
}

/**
 * Callback ref that fades an element up the first time it scrolls into view.
 * Pair it with a `data-reveal` attribute (`data-reveal="fade"` for opacity
 * only). Stable module-level function, so React never re-attaches it.
 */
export function revealRef(el: HTMLElement | null): (() => void) | undefined {
  if (!el || el.dataset.revealed) return undefined;
  if (typeof IntersectionObserver === 'undefined') {
    el.dataset.revealed = 'true';
    return undefined;
  }
  const obs = getObserver();
  obs.observe(el);
  return () => obs.unobserve(el);
}
