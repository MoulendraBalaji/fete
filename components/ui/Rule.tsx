import styles from './Rule.module.css';

export interface RuleProps {
  /** Adds a centred label, like a section divider on a form. */
  label?: string;
  /** `ornament` renders a small diamond in the centre. */
  variant?: 'plain' | 'ornament';
  className?: string;
}

/** A ruled divider; the visual grammar of lined ledger paper. */
export function Rule({ label, variant = 'plain', className }: RuleProps) {
  const classes = [styles.rule, className].filter(Boolean).join(' ');
  if (!label && variant === 'plain') return <hr className={classes} />;
  return (
    <div className={classes} role="separator" aria-label={label}>
      <span className={styles.line} aria-hidden="true" />
      {variant === 'ornament' ? <span className={styles.ornament} aria-hidden="true" /> : null}
      {label ? <span className={styles.label}>{label}</span> : null}
      <span className={styles.line} aria-hidden="true" />
    </div>
  );
}
