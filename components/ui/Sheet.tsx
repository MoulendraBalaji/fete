import type { ElementType, ReactNode } from 'react';
import styles from './Sheet.module.css';

type SheetTone = 'plain' | 'inset' | 'accent' | 'stamp';

export interface SheetProps {
  children: ReactNode;
  as?: ElementType;
  /** `plain` card stock, `inset` a recessed well, `accent`/`stamp` tinted. */
  tone?: SheetTone;
  /** Adds a punch-hole + tape header, like a pasted note. */
  pinned?: boolean;
  /** Renders the two small punch holes on the left edge. */
  punched?: boolean;
  className?: string;
  /** Marks the sheet as an unbreakable unit when printing. */
  printable?: boolean;
}

/**
 * A sheet of stationery: the base surface for every panel in the app.
 * Renders as `<section>` by default; pass `as` for article/aside/li.
 */
export function Sheet({
  children,
  as: Component = 'section',
  tone = 'plain',
  pinned = false,
  punched = false,
  className,
  printable = true,
}: SheetProps) {
  const classes = [styles.sheet, styles[tone], pinned ? styles.pinned : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <Component
      className={classes}
      data-print={printable ? 'avoid-break' : undefined}
      data-print-surface="sheet"
    >
      {punched ? <span className={styles.holes} aria-hidden="true" /> : null}
      {children}
    </Component>
  );
}
