'use client';

import { useEffect } from 'react';
import { Sheet } from '@/components/ui/Sheet';
import { Button } from '@/components/ui/Button';
import { Logo } from '@/components/brand/Logo';
import styles from './error.module.css';

/**
 * Route-level error boundary.
 *
 * It shows a friendly message and, crucially, a way to recover *without losing
 * data*: because every plan is written to `localStorage` as it changes, a reload
 * is always safe. The digest is shown for bug reports but never includes the
 * error message's stack, since that could echo user content.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // One line, no user content: enough to correlate with a browser report.
    console.error('Fête route error', error.digest ?? '(no digest)');
  }, [error]);

  return (
    <div className={styles.shell}>
      <Logo />
      <Sheet className={styles.card}>
        <h1 className={styles.title}>Something went wrong on this screen</h1>
        <p className={styles.body}>
          Your plans are safe — they are saved in this browser as you work. Reloading is always
          safe, and nothing you have entered will be lost.
        </p>
        {error.digest ? <p className={styles.digest}>Reference: {error.digest}</p> : null}
        <div className={styles.actions}>
          <Button variant="primary" onClick={reset}>
            Try again
          </Button>
          <Button variant="secondary" onClick={() => window.location.assign('/')}>
            Back to my plans
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
