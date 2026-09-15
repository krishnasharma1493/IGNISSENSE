import { useEffect, useState } from 'react';
import { prefersReducedMotion } from './motion';

/**
 * Keeps something on screen long enough to animate out.
 *
 * Pass the value that should be shown, or `null` when it should go. When it
 * goes, the last value is returned with `exiting: true` for `exitMs`, then
 * `null`. Coming back during the exit cancels it. With reduced motion the exit
 * is immediate.
 *
 * The value must keep a stable identity while it is shown (a query result, a
 * memoised object, a string), because a new identity each render would be
 * retained again each render.
 */
export function usePresence<T>(value: T | null | undefined, exitMs = 200) {
  const [retained, setRetained] = useState<T | null>(value ?? null);
  const [exiting, setExiting] = useState(false);

  if (value != null) {
    if (value !== retained) setRetained(value);
    if (exiting) setExiting(false);
  } else if (retained !== null && !exiting) {
    setExiting(true);
  }

  useEffect(() => {
    if (!exiting) return undefined;
    const id = window.setTimeout(
      () => {
        setRetained(null);
        setExiting(false);
      },
      prefersReducedMotion() ? 0 : exitMs
    );
    return () => window.clearTimeout(id);
  }, [exiting, exitMs]);

  return {
    value: value ?? retained,
    exiting: value == null && retained !== null,
  };
}
