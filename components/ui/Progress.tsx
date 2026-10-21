import styles from './Progress.module.css';

export interface ProgressProps {
  /** 0–1. Values outside the range are clamped. */
  ratio: number;
  label: string;
  /** Colour intent; `auto` uses ledger green up to the target, gold past it. */
  tone?: 'auto' | 'stamp' | 'accent' | 'warn' | 'danger';
  /** Shows the numeric percentage next to the label. */
  showValue?: boolean;
  className?: string;
}

/**
 * A progress bar built on `role="progressbar"`, so screen readers announce the
 * value. Over-budget progress is shown *past* the track end via a separate
 * marker rather than an overflowing bar, so it stays readable at 120%+.
 */
export function Progress({
  ratio,
  label,
  tone = 'auto',
  showValue = true,
  className,
}: ProgressProps) {
  const safe = Number.isFinite(ratio) ? Math.max(0, ratio) : 0;
  const clamped = Math.min(1, safe);
  const resolved = tone === 'auto' ? (safe > 1 ? 'warn' : 'stamp') : tone;
  const percent = Math.round(safe * 100);

  return (
    <div className={[styles.wrap, className].filter(Boolean).join(' ')}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        {showValue ? <span className={`mono ${styles.value}`}>{percent}%</span> : null}
      </div>
      <div
        className={styles.track}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={`${percent}%`}
      >
        <span
          className={`${styles.fill} ${styles[resolved]}`}
          style={{ width: `${clamped * 100}%` }}
        />
      </div>
    </div>
  );
}
