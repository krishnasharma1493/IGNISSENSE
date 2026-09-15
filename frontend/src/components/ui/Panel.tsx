import type { HTMLAttributes, ReactNode } from 'react';

type Level = 'chrome' | 'panel' | 'popover';

const LEVEL_CLASS: Record<Level, string> = {
  chrome: 'glass',
  panel: 'glass-panel-l2',
  popover: 'glass-popover',
};

interface PanelProps extends HTMLAttributes<HTMLElement> {
  level?: Level;
  className?: string;
  children: ReactNode;
  as?: 'div' | 'aside' | 'header' | 'nav' | 'section';
}

/**
 * The only way to put the glass material on screen.
 *
 * Three levels exist and they do not nest — stacking backdrop-filters is what
 * made the previous build feel muddy. To group content inside a Panel, use
 * `inset-surface` instead of another Panel.
 *
 * Other attributes (`aria-label`, `inert`, `role`…) pass through to the element.
 */
export default function Panel({
  level = 'panel',
  className = '',
  children,
  as: Tag = 'div',
  ...rest
}: PanelProps) {
  return (
    <Tag className={`${LEVEL_CLASS[level]} ${className}`} {...rest}>
      {children}
    </Tag>
  );
}
