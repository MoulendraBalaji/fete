'use client';

import { useState } from 'react';
import { EVENT_TYPE_LABELS, PRIORITY_HINTS, PRIORITY_LABELS } from '@/lib/ui/labels';
import { EVENT_TYPES, PRIORITY_OPTIONS } from '@/lib/schemas/core';
import { briefSchema, type Brief } from '@/lib/schemas/brief';
import { minorUnitExponent, toMajorUnits, toMinorUnits } from '@/lib/domain/money';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { Rule } from '@/components/ui/Rule';
import { Callout } from '@/components/ui/Callout';
import styles from './BriefEditor.module.css';

export interface BriefEditorProps {
  brief: Brief;
  onSave: (brief: Brief) => void;
  onCancel: () => void;
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'JPY', 'ZAR', 'BRL'] as const;

/** Editable, string-typed copy of a brief (numbers become text fields). */
interface Draft {
  eventType: Brief['eventType'];
  date: string;
  location: string;
  guestCount: string;
  budget: string;
  currency: string;
  theme: string;
  considerations: string;
  mustHaves: string;
  avoid: string;
  priorities: Brief['priorities'];
}

function draftFrom(brief: Brief): Draft {
  return {
    eventType: brief.eventType,
    date: brief.date,
    location: brief.location,
    guestCount: String(brief.guestCount),
    budget: String(toMajorUnits(brief.budgetMinor, brief.currency)),
    currency: brief.currency,
    theme: brief.theme,
    considerations: brief.considerations,
    mustHaves: brief.mustHaves.join(', '),
    avoid: brief.avoid.join(', '),
    priorities: [...brief.priorities],
  };
}

function toList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

/**
 * Edits an existing brief and re-derives the plan from it.
 *
 * This is a single scrolling form rather than the five-step wizard: the user
 * already knows their brief, and stepping through five screens to change one
 * date would be tedious. The trade-off is that all fields are validated at once
 * on save, so a bad value surfaces in an error summary at the top.
 *
 * Saving **re-derives** rather than patches: budget rows, milestones and day-of
 * items are regenerated from the new brief, while the user's own edits that the
 * rebuild can map (vendor names, task completions) are carried over. The caller
 * owns that logic; this component only produces a valid brief.
 */
export function BriefEditor({ brief, onSave, onCancel }: BriefEditorProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(brief));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const exponent = minorUnitExponent(draft.currency);
  const currencyStep = (1 / 10 ** exponent).toFixed(exponent);

  function patch<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function candidate(): Record<string, unknown> {
    const budgetMajor = Number.parseFloat(draft.budget);
    return {
      eventType: draft.eventType,
      date: draft.date,
      location: draft.location.trim(),
      guestCount: draft.guestCount.trim() === '' ? undefined : Number(draft.guestCount),
      budgetMinor: Number.isFinite(budgetMajor)
        ? toMinorUnits(budgetMajor, draft.currency)
        : undefined,
      currency: draft.currency,
      theme: draft.theme.trim(),
      considerations: draft.considerations.trim(),
      mustHaves: toList(draft.mustHaves),
      avoid: toList(draft.avoid),
      priorities: draft.priorities,
    };
  }

  function submit() {
    const parsed = briefSchema.safeParse(candidate());
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }
    onSave(parsed.data);
  }

  const errorList = Object.values(errors);

  return (
    <Sheet className={styles.editor}>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Edit the brief</h2>
          <p className={styles.sub}>
            Changing the date, guests or budget re-derives the whole plan. Completed tasks and
            recorded vendor details are kept where they still apply.
          </p>
        </div>
      </header>

      {errorList.length > 0 ? (
        <Callout tone="danger" title="Check these fields" live="assertive">
          {errorList.join(' ')}
        </Callout>
      ) : null}

      <div className={styles.grid}>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>What are we planning?</legend>
          <div className={styles.choices} role="radiogroup" aria-label="Event type">
            {EVENT_TYPES.map((type) => (
              <label
                key={type}
                className={[styles.choice, draft.eventType === type ? styles.choiceOn : '']
                  .filter(Boolean)
                  .join(' ')}
              >
                <input
                  type="radio"
                  name="eventType"
                  value={type}
                  checked={draft.eventType === type}
                  onChange={() => patch('eventType', type)}
                />
                <span>{EVENT_TYPE_LABELS[type]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <Rule />

        <div className={styles.twoUp}>
          <Field label="Event date" required error={errors.date}>
            {({ id, describedBy, invalid }) => (
              <input
                id={id}
                className={styles.input}
                type="date"
                value={draft.date}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                onChange={(event) => patch('date', event.target.value)}
              />
            )}
          </Field>

          <Field label="Location" required error={errors.location}>
            {({ id, describedBy, invalid }) => (
              <input
                id={id}
                className={styles.input}
                type="text"
                maxLength={160}
                value={draft.location}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                onChange={(event) => patch('location', event.target.value)}
              />
            )}
          </Field>
        </div>

        <div className={styles.twoUp}>
          <Field label="Expected guests" required error={errors.guestCount}>
            {({ id, describedBy, invalid }) => (
              <input
                id={id}
                className={styles.input}
                type="number"
                min={1}
                max={100000}
                inputMode="numeric"
                value={draft.guestCount}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                onChange={(event) => patch('guestCount', event.target.value)}
              />
            )}
          </Field>
        </div>

        <div className={styles.twoUp}>
          <Field label="Total budget" required error={errors.budgetMinor}>
            {({ id, describedBy, invalid }) => (
              <input
                id={id}
                className={styles.input}
                type="number"
                min={0}
                step={currencyStep}
                inputMode="decimal"
                value={draft.budget}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                onChange={(event) => patch('budget', event.target.value)}
              />
            )}
          </Field>

          <Field label="Currency" required error={errors.currency}>
            {({ id, invalid }) => (
              <select
                id={id}
                className={styles.input}
                value={draft.currency}
                aria-invalid={invalid}
                onChange={(event) => patch('currency', event.target.value)}
              >
                {CURRENCIES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <Rule />

        <Field label="Theme or vibe" error={errors.theme}>
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              className={styles.input}
              type="text"
              maxLength={160}
              value={draft.theme}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => patch('theme', event.target.value)}
            />
          )}
        </Field>

        <Field label="Considerations" error={errors.considerations}>
          {({ id, describedBy, invalid }) => (
            <textarea
              id={id}
              className={styles.textarea}
              rows={3}
              maxLength={320}
              value={draft.considerations}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              onChange={(event) => patch('considerations', event.target.value)}
            />
          )}
        </Field>

        <div className={styles.twoUp}>
          <Field label="Must-haves" hint="Comma-separated, up to 8." error={errors.mustHaves}>
            {({ id, describedBy, invalid }) => (
              <input
                id={id}
                className={styles.input}
                type="text"
                value={draft.mustHaves}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                onChange={(event) => patch('mustHaves', event.target.value)}
              />
            )}
          </Field>

          <Field label="Please avoid" hint="Comma-separated, up to 8." error={errors.avoid}>
            {({ id, describedBy, invalid }) => (
              <input
                id={id}
                className={styles.input}
                type="text"
                value={draft.avoid}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                onChange={(event) => patch('avoid', event.target.value)}
              />
            )}
          </Field>
        </div>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>What matters most? (up to 3)</legend>
          <div className={styles.priorityGrid}>
            {PRIORITY_OPTIONS.map((priority) => {
              const checked = draft.priorities.includes(priority);
              const atLimit = draft.priorities.length >= 3 && !checked;
              return (
                <label
                  key={priority}
                  className={[styles.priority, checked ? styles.priorityOn : '']
                    .filter(Boolean)
                    .join(' ')}
                  title={PRIORITY_HINTS[priority]}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={atLimit}
                    onChange={() =>
                      patch(
                        'priorities',
                        checked
                          ? draft.priorities.filter((item) => item !== priority)
                          : [...draft.priorities, priority],
                      )
                    }
                  />
                  <span>{PRIORITY_LABELS[priority]}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      <Rule />

      <footer className={styles.foot}>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={submit}>
          Save &amp; re-derive plan
        </Button>
      </footer>
    </Sheet>
  );
}
