import { useId, type ReactNode } from 'react';
import styles from './Field.module.css';

export interface FieldProps {
  label: string;
  children: (props: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
  /** Guidance shown under the control; also read as the description. */
  hint?: string;
  /** Validation message; when present the field is marked invalid. */
  error?: string;
  /** Marks the field as required for assistive tech (the caller adds `required`). */
  required?: boolean;
  className?: string;
}

/**
 * A labelled form field.
 *
 * This uses a render-prop so the label, hint and error are wired to the control
 * through generated ids — the caller cannot forget `htmlFor`/`aria-describedby`,
 * and `aria-invalid` follows the presence of an error automatically.
 */
export function Field({ label, children, hint, error, required, className }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={[styles.field, className].filter(Boolean).join(' ')}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {required ? (
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {hint ? (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
