import { useEffect } from 'react';
import type { RefObject } from 'react';

/**
 * Proximity-spring pill for the top dock.
 *
 * Every element inside `containerRef` marked `data-dock-item` owns a background
 * pill (`.dock-pill`) that grows toward the pointer. The item's content never
 * scales or moves sideways, so neighbouring labels can't be covered.
 *
 *   influence = smoothstep(clamp(1 − distance / RADIUS, 0, 1))
 *
 * where distance runs from the pointer to the nearest point of the item's resting
 * box (an item under the pointer is at full influence). The sprung value is written
 * to the item as the CSS variable `--dock-g` (0‥1); CSS turns it into pill growth,
 * pill opacity and a half-step downward nudge of the content.
 *
 * Growth is bounded by geometry, measured on resize, never per frame:
 *   --dock-grow-y  room left between the item's bottom and the dock's inner bottom
 *                  (capped at MAX_GROW_Y), so the pill stays inside the bar;
 *   --dock-grow-x  just under half the gap to the nearest dock-item neighbour
 *                  (capped at MAX_GROW_X), so two growing pills can never touch.
 *
 * The spring is critically damped per frame — no overshoot, so a bounded pill
 * never springs past its bound — and integrated on a fixed 60 Hz step so it
 * feels the same on 60 Hz and 120 Hz displays. Nothing is read from layout in
 * the frame loop. Disabled on coarse pointers and under prefers-reduced-motion;
 * the loop stops when every item has settled.
 */

export const DOCK_RADIUS = 122;
export const DOCK_SPRING = 0.14;
export const DOCK_DAMPING = 0.4;
export const DOCK_MAX_GROW_Y_PX = 16;
export const DOCK_MAX_GROW_X_PX = 4;

const STEP_MS = 1000 / 60;
const EPSILON = 0.0005;

export function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** Distance from a point to the nearest point of an axis-aligned box (0 inside it). */
export function distanceToBox(px: number, py: number, left: number, top: number, width: number, height: number): number {
  const dx = Math.max(left - px, 0, px - (left + width));
  const dy = Math.max(top - py, 0, py - (top + height));
  return Math.hypot(dx, dy);
}

export function influenceAt(distance: number): number {
  return smoothstep(1 - distance / DOCK_RADIUS);
}

/** One spring step: returns [position, velocity]. */
export function springStep(x: number, v: number, target: number): [number, number] {
  const nv = v * DOCK_DAMPING + (target - x) * DOCK_SPRING;
  return [x + nv, nv];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface ItemState {
  el: HTMLElement;
  // Resting box in viewport coordinates.
  left: number;
  top: number;
  width: number;
  height: number;
  g: number;
  velocity: number;
}

export function useProximitySpring(containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const coarse = window.matchMedia('(pointer: coarse)');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    let items: ItemState[] = [];
    let pointer: { x: number; y: number } | null = null;
    let raf = 0;
    let last = 0;
    let carry = 0;

    const enabled = () => !coarse.matches && !reduced.matches;

    const measure = () => {
      const box = container.getBoundingClientRect();
      const innerBottom = box.top + container.clientTop + container.clientHeight;
      const els = Array.from(container.querySelectorAll<HTMLElement>('[data-dock-item]'));
      const previous = new Map(items.map((i) => [i.el, i]));

      items = els.map((el) => {
        // Layout offsets up to the container: unaffected by any transform.
        let left = 0;
        let top = 0;
        let node: HTMLElement | null = el;
        while (node && node !== container) {
          left += node.offsetLeft;
          top += node.offsetTop;
          node = node.offsetParent as HTMLElement | null;
        }
        const prev = previous.get(el);
        return {
          el,
          left: box.left + container.clientLeft + left,
          top: box.top + container.clientTop + top,
          width: el.offsetWidth,
          height: el.offsetHeight,
          g: prev?.g ?? 0,
          velocity: prev?.velocity ?? 0,
        };
      });

      // Geometry bounds for each pill.
      const byLeft = [...items].sort((a, b) => a.left - b.left);
      for (const item of items) {
        const growY = clamp(innerBottom - (item.top + item.height) - 1, 0, DOCK_MAX_GROW_Y_PX);
        let nearestGap = Infinity;
        for (const other of byLeft) {
          if (other === item) continue;
          const sameRow = other.top < item.top + item.height && item.top < other.top + other.height;
          if (!sameRow) continue;
          const gap =
            other.left >= item.left
              ? other.left - (item.left + item.width)
              : item.left - (other.left + other.width);
          if (gap >= 0) nearestGap = Math.min(nearestGap, gap);
        }
        const growX = clamp(nearestGap / 2 - 1, 0, DOCK_MAX_GROW_X_PX);
        item.el.style.setProperty('--dock-grow-y', `${growY.toFixed(2)}px`);
        item.el.style.setProperty('--dock-grow-x', `${growX.toFixed(2)}px`);
      }
    };

    const apply = (item: ItemState) => {
      const g = clamp(item.g, 0, 1);
      if (g < EPSILON) item.el.style.removeProperty('--dock-g');
      else item.el.style.setProperty('--dock-g', g.toFixed(4));
    };

    const targetFor = (item: ItemState) =>
      pointer && enabled()
        ? influenceAt(distanceToBox(pointer.x, pointer.y, item.left, item.top, item.width, item.height))
        : 0;

    const frame = (now: number) => {
      raf = 0;
      carry += last ? Math.min(now - last, 100) : STEP_MS;
      last = now;

      while (carry >= STEP_MS) {
        carry -= STEP_MS;
        for (const item of items) {
          [item.g, item.velocity] = springStep(item.g, item.velocity, targetFor(item));
        }
      }

      let moving = false;
      for (const item of items) {
        const target = targetFor(item);
        if (Math.abs(item.velocity) > EPSILON || Math.abs(target - item.g) > EPSILON) moving = true;
        else {
          item.g = target;
          item.velocity = 0;
        }
        apply(item);
      }

      if (moving) raf = requestAnimationFrame(frame);
      else last = 0;
    };

    const wake = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      if (!enabled()) return;
      pointer = { x: e.clientX, y: e.clientY };
      wake();
    };
    const release = () => {
      pointer = null;
      wake();
    };
    const onVisibility = () => document.visibilityState !== 'visible' && release();
    // A keyboard user is not pointing at the dock; let it settle back.
    const onKey = (e: KeyboardEvent) => e.key === 'Tab' && release();
    const onPreference = () => {
      if (!enabled()) {
        pointer = null;
        for (const item of items) {
          item.g = 0;
          item.velocity = 0;
          apply(item);
        }
      }
    };

    measure();
    const ro = new ResizeObserver(() => measure());
    ro.observe(container);
    for (const item of items) ro.observe(item.el);

    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', release);
    window.addEventListener('blur', release);
    window.addEventListener('resize', measure);
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVisibility);
    coarse.addEventListener('change', onPreference);
    reduced.addEventListener('change', onPreference);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', release);
      window.removeEventListener('blur', release);
      window.removeEventListener('resize', measure);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      coarse.removeEventListener('change', onPreference);
      reduced.removeEventListener('change', onPreference);
      for (const item of items) {
        item.el.style.removeProperty('--dock-g');
        item.el.style.removeProperty('--dock-grow-x');
        item.el.style.removeProperty('--dock-grow-y');
      }
    };
  }, [containerRef]);
}
