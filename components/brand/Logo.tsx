import styles from './Logo.module.css';

export interface LogoProps {
  /** `full` renders the wordmark next to the seal; `seal` is the mark alone. */
  variant?: 'full' | 'seal';
  className?: string;
}

/**
 * The Fête mark: a sealing-wax seal bearing a single "F", drawn with inline SVG
 * so it inherits `currentColor` and needs no image request or icon library.
 *
 * The wordmark's accent is a real character (ë) rather than a decorative overlay,
 * so the name stays correct when copied as text.
 */
export function Logo({ variant = 'full', className }: LogoProps) {
  return (
    <span className={[styles.logo, className].filter(Boolean).join(' ')}>
      <svg
        className={styles.seal}
        viewBox="0 0 48 48"
        role="img"
        aria-label="Fête"
        focusable="false"
      >
        {/* Irregular blob edge: the wobble of pressed wax. */}
        <path
          className={styles.wax}
          d="M24 2.5c4.6-.6 7.3 2.1 11.1 3.6 4 1.6 6.9 4.2 7.6 8.5.7 4.2-.9 7.1-1.2 11.2-.3 4.1 1.6 7-1 10.9-2.5 3.8-6 4.3-9.9 6-3.9 1.7-7.3 3.4-11.6 2.3-4.3-1.1-6.4-4.4-9.2-7.9-2.8-3.5-4.7-6.6-4.2-11 .5-4.4 3.3-6.9 4.8-10.6C12.9 11 14 5.9 18.2 4.1 20.3 3.2 21.7 2.8 24 2.5Z"
        />
        <path
          className={styles.ridge}
          d="M24 5.5c4-.5 6.3 1.9 9.6 3.2 3.4 1.3 5.9 3.6 6.5 7.3.6 3.6-.8 6.1-1 9.6-.3 3.5 1.4 6-.9 9.3-2.1 3.2-5.1 3.7-8.4 5.1-3.3 1.4-6.2 2.9-9.9 2-3.6-.9-5.4-3.7-7.8-6.7-2.4-3-4-5.6-3.6-9.4.4-3.7 2.8-5.9 4.1-9C14.9 13 15.8 8.7 19.4 7.1c1.8-.8 3-.1 4.6-1.6Z"
        />
        <text
          className={styles.letter}
          x="24"
          y="24"
          textAnchor="middle"
          dominantBaseline="central"
        >
          F
        </text>
      </svg>
      {variant === 'full' ? (
        <span className={styles.wordmark}>
          Fête
          <span className={styles.tagline}>plans, kept beautifully</span>
        </span>
      ) : null}
    </span>
  );
}
