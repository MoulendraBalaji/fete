'use client';

import { useId, useRef, type ReactNode } from 'react';
import styles from './Tabs.module.css';

export interface TabItem {
  id: string;
  label: string;
  /** Optional count or short status shown as a superscript chip. */
  badge?: string;
  panel: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: readonly TabItem[];
  activeId: string;
  onChange: (id: string) => void;
  /** Accessible name for the tab list (required: there may be several). */
  label: string;
  className?: string;
}

/**
 * An accessible tab set following the WAI-ARIA tabs pattern:
 * arrow keys move between tabs (roving `tabIndex`), `Home`/`End` jump to the
 * ends, and each tab is linked to its panel with `aria-controls`.
 *
 * A panel is kept mounted once it has been given content, so in-progress edits
 * and scroll position in one section survive a trip to another — losing a
 * half-typed budget row when glancing at the timeline would be hostile. A panel
 * whose `panel` is `null` renders nothing at all, letting the caller decide when
 * a section is worth building (see `Workspace`, which creates each panel on
 * first visit).
 */
export function Tabs({ items, activeId, onChange, label, className }: TabsProps) {
  const baseId = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const enabled = items.filter((item) => !item.disabled);

  function focusTab(offset: number) {
    const index = enabled.findIndex((item) => item.id === activeId);
    if (index === -1) return;
    const next = enabled[(index + offset + enabled.length) % enabled.length];
    if (!next) return;
    onChange(next.id);
    refs.current[next.id]?.focus();
  }

  return (
    <div className={[styles.tabs, className].filter(Boolean).join(' ')}>
      <div className={styles.list} role="tablist" aria-label={label}>
        {items.map((item) => {
          const selected = item.id === activeId;
          return (
            <button
              key={item.id}
              ref={(node) => {
                refs.current[item.id] = node;
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              className={[styles.tab, selected ? styles.selected : ''].filter(Boolean).join(' ')}
              onClick={() => onChange(item.id)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  focusTab(1);
                } else if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  focusTab(-1);
                } else if (event.key === 'Home') {
                  event.preventDefault();
                  const first = enabled[0];
                  if (first) {
                    onChange(first.id);
                    refs.current[first.id]?.focus();
                  }
                } else if (event.key === 'End') {
                  event.preventDefault();
                  const last = enabled[enabled.length - 1];
                  if (last) {
                    onChange(last.id);
                    refs.current[last.id]?.focus();
                  }
                }
              }}
            >
              {item.label}
              {item.badge ? <span className={styles.badge}>{item.badge}</span> : null}
            </button>
          );
        })}
      </div>

      {items.map((item) => {
        // A tab that has never been opened has no panel, so there is nothing to
        // put in the DOM — rendering an empty `tabpanel` would create a landmark
        // a screen reader can reach with nothing inside it.
        if (item.panel === null) return null;
        const isActive = item.id === activeId;
        return (
          <div
            key={item.id}
            role="tabpanel"
            id={`${baseId}-panel-${item.id}`}
            aria-labelledby={`${baseId}-tab-${item.id}`}
            hidden={!isActive}
            // Only the visible panel is in the tab order, per the ARIA tabs
            // pattern; `hidden` already removes the others, but being explicit
            // means the intent survives a CSS change that drops `hidden`.
            tabIndex={isActive ? 0 : -1}
            className={styles.panel}
          >
            {item.panel}
          </div>
        );
      })}
    </div>
  );
}
