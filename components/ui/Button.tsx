import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface CommonProps {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
  className?: string;
  /** Shows a spinner and blocks interaction while an async action runs. */
  busy?: boolean;
}

export type ButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>;

function classes(variant: Variant, size: Size, className?: string) {
  return [styles.button, styles[variant], styles[size], className].filter(Boolean).join(' ');
}

/**
 * The app's button. A real `<button>` with an explicit `type` (default
 * `button`, so it never submits a form by accident) and an `aria-busy` flag
 * while an action is in flight.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  busy = false,
  disabled,
  children,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={classes(variant, size, className)}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? <span className={styles.spinner} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export type LinkButtonProps = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'children'>;

/** A link styled as a button (for downloads and external links). */
export function LinkButton({
  variant = 'secondary',
  size = 'md',
  children,
  className,
  ...rest
}: LinkButtonProps) {
  return (
    <a {...rest} className={classes(variant, size, className)}>
      {children}
    </a>
  );
}
