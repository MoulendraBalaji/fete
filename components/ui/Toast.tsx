'use client';

import { useEffect, useState } from 'react';
import styles from './Toast.module.css';

export type ToastTone = 'info' | 'success' | 'danger';

export interface ToastProps {
  message: string;
  tone?: ToastTone;
  /** Milliseconds before auto-dismiss; 0 keeps it until dismissed. */
  duration?: number;
  onDismiss: () => void;
  /** An optional single action, e.g. "Undo". */
  action?: { label: string; onClick: () => void };
}

/**
 * A transient status message, anchored bottom-left like a sticky note.
 *
 * It uses `role="status"`/`aria-live="polite"` so the message is announced
 * without stealing focus. The timer is cleared on unmount, and pausing on
 * hover/focus would need pointer tracking — instead we default to a generous
 * duration and always expose an explicit dismiss control.
 */
export function Toast({ message, tone = 'info', duration = 5000, onDismiss, action }: ToastProps) {
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (duration <= 0 || paused) return;
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [duration, paused, onDismiss]);

  return (
    <div
      className={[styles.toast, styles[tone]].join(' ')}
      role="status"
      aria-live="polite"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      data-print="hide"
    >
      <span className={styles.message}>{message}</span>
      {action ? (
        <button type="button" className={styles.action} onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
      <button
        type="button"
        className={styles.close}
        onClick={onDismiss}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}
