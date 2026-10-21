'use client';

import { useTheme } from '@/lib/hooks/useTheme';
import styles from './ThemeToggle.module.css';

/** Switches between the daylight paper palette and the evening one. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const isEvening = theme === 'evening';

  return (
    <button
      type="button"
      className={styles.toggle}
      onClick={toggle}
      aria-pressed={isEvening}
      title={isEvening ? 'Switch to daylight' : 'Switch to evening'}
      data-print="hide"
    >
      <span aria-hidden="true" className={styles.glyph}>
        {isEvening ? '☾' : '☀'}
      </span>
      <span className={styles.label}>{isEvening ? 'Evening' : 'Daylight'}</span>
    </button>
  );
}
