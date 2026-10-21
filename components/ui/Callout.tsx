import type { ReactNode } from 'react';
import styles from './Callout.module.css';

export type CalloutTone = 'info' | 'success' | 'warn' | 'danger' | 'note';

export interface CalloutProps {
  children: ReactNode;
  tone?: CalloutTone;
  /** Short heading; the body carries the detail. */
  title?: string;
  /** Extra controls (a dismiss button, a retry link) rendered on the right. */
  action?: ReactNode;
  /** `polite` (default) or `assertive`; assertive is for hard failures. */
  live?: 'off' | 'polite' | 'assertive';
  className?: string;
}

/**
 * A margin note. Used for AI status, offline warnings and validation summaries.
 *
 * The shape (a coloured bar down the left edge + a bold title) is the same for
 * every tone, so the message is never conveyed by colour alone.
 */
export function Callout({
  children,
  tone = 'info',
  title,
  action,
  live = 'off',
  className,
}: CalloutProps) {
  return (
    <div
      className={[styles.callout, styles[tone], className].filter(Boolean).join(' ')}
      role={live === 'off' ? undefined : 'status'}
      aria-live={live === 'off' ? undefined : live}
    >
      <div className={styles.body}>
        {title ? <p className={styles.title}>{title}</p> : null}
        <div className={styles.text}>{children}</div>
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
