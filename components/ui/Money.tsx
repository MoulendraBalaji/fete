import { formatMoney } from '@/lib/domain/money';
import styles from './Money.module.css';

export interface MoneyProps {
  /** Integer count of the currency's minor unit (e.g. 120050 → $1,200.50). */
  minor: number;
  currency: string;
  /** Show an explicit `+`/`−` sign — useful for ledger deltas. */
  signed?: boolean;
  /** Renders negatives in the danger colour instead of plain ink. */
  toneBySign?: boolean;
  className?: string;
  /** Accessible label overriding the raw value (e.g. "Total planned"). */
  label?: string;
}

/**
 * Locale-independent money display.
 *
 * The locale is pinned to `en-US` (rather than resolved from the browser) so
 * the server and client render the identical string. A locale-dependent format
 * would risk a hydration mismatch on the very first paint.
 */
export function Money({ minor, currency, signed, toneBySign, className, label }: MoneyProps) {
  const formatted = formatMoney(Math.abs(minor), currency, 'en-US');
  const sign = minor < 0 ? '−' : signed && minor > 0 ? '+' : '';
  const classes = ['mono', styles.money, toneBySign && minor < 0 ? styles.negative : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} aria-label={label}>
      {sign}
      {formatted}
    </span>
  );
}
