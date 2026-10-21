import type { ReactNode } from 'react';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  title: string;
  children?: ReactNode;
  /** A call to action, e.g. a "Create a plan" button. */
  action?: ReactNode;
  className?: string;
}

/** Shown when a collection is legitimately empty — never as an error. */
export function EmptyState({ title, children, action, className }: EmptyStateProps) {
  return (
    <div className={[styles.empty, className].filter(Boolean).join(' ')}>
      <span className={styles.ornament} aria-hidden="true">
        ❧
      </span>
      <p className={styles.title}>{title}</p>
      {children ? <div className={styles.body}>{children}</div> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
