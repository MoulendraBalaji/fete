'use client';

import { useCallback, useEffect, useState } from 'react';

export type Theme = 'day' | 'evening';

const STORAGE_KEY = 'fete.theme';

function readTheme(): Theme {
  if (typeof document === 'undefined') return 'day';
  return document.documentElement.getAttribute('data-theme') === 'evening' ? 'evening' : 'day';
}

/**
 * Reads and writes the colour theme.
 *
 * The *initial* value is read from the `<html data-theme>` attribute that the
 * pre-hydration script already set, so the toggle starts in sync with what the
 * user is looking at instead of guessing and correcting (which would flicker).
 * The write side also updates the attribute directly — no re-render needed for
 * a change that lives outside React.
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>('day');

  useEffect(() => {
    setTheme(readTheme());
  }, []);

  const toggle = useCallback(() => {
    const next: Theme = readTheme() === 'evening' ? 'day' : 'evening';
    document.documentElement.setAttribute('data-theme', next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode: the theme still applies for this session.
    }
    setTheme(next);
  }, []);

  return { theme, toggle };
}
