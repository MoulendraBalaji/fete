import type { ReactNode } from 'react';
import styles from './Stamp.module.css';

export type StampTone = 'neutral' | 'green' | 'accent' | 'gold' | 'warn' | 'danger' | 'info';

export interface StampProps {
  children: ReactNode;
  tone?: StampTone;
  /** Renders as an outline "approved" mark instead of a filled sticker. */
  outline?: boolean;
  /** Small chip proportions, for inline use next to text. */
  small?: boolean;
  className?: string;
  /** Optional accessible context when the label is terse (e.g. "High"). */
  title?: string;
}

/**
 * A rubber stamp: the app's badge for statuses, priorities and cost tiers.
 * Colour is never the only signal — the text label always carries the meaning.
 */
export function Stamp({
  children,
  tone = 'neutral',
  outline,
  small,
  className,
  title,
}: StampProps) {
  const classes = [
    styles.stamp,
    styles[tone],
    outline ? styles.outline : '',
    small ? styles.small : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes} title={title}>
      {children}
    </span>
  );
}
