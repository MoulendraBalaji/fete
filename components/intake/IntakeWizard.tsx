'use client';

import { useMemo, useState } from 'react';
import {
  EVENT_TYPE_LABELS,
  EVENT_TYPE_BLURBS,
  PRIORITY_HINTS,
  PRIORITY_LABELS,
} from '@/lib/ui/labels';
import { EVENT_TYPES, PRIORITY_OPTIONS } from '@/lib/schemas/core';
import {
  INTAKE_STEP_COUNT,
  briefSchema,
  validateStep,
  type IntakeStepIndex,
} from '@/lib/schemas/brief';
import { minorUnitExponent, toMinorUnits } from '@/lib/domain/money';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { Rule } from '@/components/ui/Rule';
import { Callout } from '@/components/ui/Callout';
import styles from './IntakeWizard.module.css';

export interface IntakeWizardProps {
  /** Pre-filled values (from a sample, an import, or a re-open). */
  initial?: Partial<IntakeDraft>;
  onComplete: (brief: IntakeBrief) => void;
  onCancel?: () => void;
  /** Samples offered before the user commits to a blank brief. */
  samples?: ReadonlyArray<{ eventType: (typeof EVENT_TYPES)[number]; label: string }>;
  onPickSample?: (eventType: (typeof EVENT_TYPES)[number]) => void;
}

export interface IntakeDraft {
  eventType: (typeof EVENT_TYPES)[number];
  date: string;
  location: string;
  guestCount: string;
  budget: string;
  currency: string;
  theme: string;
  considerations: string;
  mustHaves: string;
  avoid: string;
  priorities: string[];
}

export type IntakeBrief = ReturnType<typeof briefSchema.parse>;

const STEP_TITLES = [
  'What are we planning?',
  'When and where',
  'How many guests',
  'The budget',
  'The finishing touches',
] as const;

const STEP_HINTS = [
  'Pick the shape of the event. It changes the budget template and the checklist.',
  'A date in the future keeps the countdown honest.',
  'A good estimate now beats a perfect one next month.',
  'Set the ceiling. The ledger will always add up to exactly this.',
  'All optional — but the more you share, the sharper the assistant.',
] as const;

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'JPY', 'ZAR', 'BRL'] as const;

export function emptyDraft(): IntakeDraft {
  return {
    eventType: 'wedding',
    date: '',
    location: '',
    guestCount: '',
    budget: '',
    currency: 'USD',
    theme: '',
    considerations: '',
    mustHaves: '',
    avoid: '',
    priorities: [],
  };
}

/** Splits a comma-separated field into clean list items, capped at 8. */
function toList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

/**
 * The five-step intake interview.
 *
 * Validation is per-step via `validateStep`, which reuses the *same* zod shape
 * the API routes enforce — so the client cannot accept a brief the server would
 * reject, and the error messages are identical in both places.
 */
export function IntakeWizard({
  initial,
  onComplete,
  onCancel,
  samples,
  onPickSample,
}: IntakeWizardProps) {
  const [step, setStep] = useState<IntakeStepIndex>(0);
  const [draft, setDraft] = useState<IntakeDraft>({ ...emptyDraft(), ...initial });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showAll, setShowAll] = useState(false);

  const exponent = minorUnitExponent(draft.currency);
  const currencyStep = (1 / 10 ** exponent).toFixed(exponent);

  function patch<K extends keyof IntakeDraft>(key: K, value: IntakeDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  /** Converts the friendly draft into the exact shape the schema validates. */
  function toCandidate(): Record<string, unknown> {
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

  function validateCurrentStep(): boolean {
    const result = validateStep(step, toCandidate());
    if (result.success) return true;
    const next: Record<string, string> = {};
    for (const issue of result.issues) {
      const key = String(issue.path[0] ?? 'form');
      if (!next[key]) next[key] = issue.message;
    }
    setErrors(next);
    return false;
  }

  function goNext() {
    if (!validateCurrentStep()) return;
    setErrors({});
    setStep((current) => Math.min(INTAKE_STEP_COUNT - 1, current + 1) as IntakeStepIndex);
  }

  function goBack() {
    setErrors({});
    setStep((current) => Math.max(0, current - 1) as IntakeStepIndex);
  }

  function submit() {
    const parsed = briefSchema.safeParse(toCandidate());
    if (!parsed.success) {
      setShowAll(true);
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'form');
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      // Jump to the earliest step that owns an error.
      const firstKey = Object.keys(next)[0];
      const targetStep = firstKey ? stepOwning(firstKey) : 0;
      setStep(targetStep);
      return;
    }
    onComplete(parsed.data);
  }

  const progress = useMemo(() => ((step + 1) / INTAKE_STEP_COUNT) * 100, [step]);
  const isLast = step === INTAKE_STEP_COUNT - 1;

  return (
    <Sheet className={styles.wizard} pinned>
      <header className={styles.head}>
        <div>
          <p className={styles.eyebrow}>
            Step {step + 1} of {INTAKE_STEP_COUNT}
          </p>
          <h2 className={styles.title}>{STEP_TITLES[step]}</h2>
          <p className={styles.hint}>{STEP_HINTS[step]}</p>
        </div>
        <span className={`mono ${styles.percent}`}>{Math.round(progress)}%</span>
      </header>

      <ol className={styles.rail} aria-label="Intake progress">
        {STEP_TITLES.map((title, index) => (
          <li
            key={title}
            className={[
              styles.railItem,
              index === step ? styles.railActive : '',
              index < step ? styles.railDone : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span className={styles.railDot} aria-hidden="true">
              {index < step ? '✓' : index + 1}
            </span>
            <span className="srOnly">
              {index < step ? 'Completed: ' : index === step ? 'Current step: ' : 'Not started: '}
              {title}
            </span>
          </li>
        ))}
      </ol>

      <Rule />

      {step === 0 ? (
        <div className={styles.grid}>
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
                <span className={styles.choiceTitle}>{EVENT_TYPE_LABELS[type]}</span>
                <span className={styles.choiceBlurb}>{EVENT_TYPE_BLURBS[type]}</span>
              </label>
            ))}
          </div>

          {samples && samples.length > 0 && onPickSample ? (
            <Callout tone="note" title="In a hurry?">
              <div className={styles.samples}>
                {samples.map((sample) => (
                  <Button
                    key={sample.eventType}
                    size="sm"
                    variant="ghost"
                    onClick={() => onPickSample(sample.eventType)}
                  >
                    Use the {sample.label} sample
                  </Button>
                ))}
              </div>
            </Callout>
          ) : null}
        </div>
      ) : null}

      {step === 1 ? (
        <div className={styles.grid}>
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

          <Field
            label="Location"
            required
            hint="City, venue, or “aunt's back garden”."
            error={errors.location}
          >
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
      ) : null}

      {step === 2 ? (
        <div className={styles.grid}>
          <Field
            label="Expected guests"
            required
            hint="A rough number is fine; the budget per head is what matters."
            error={errors.guestCount}
          >
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
      ) : null}

      {step === 3 ? (
        <div className={styles.grid}>
          <div className={styles.twoUp}>
            <Field
              label="Total budget"
              required
              hint={`In major units — e.g. 25000 means 25,000 ${draft.currency}.`}
              error={errors.budgetMinor}
            >
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

          <Callout tone="note">
            Every amount is stored as whole {draft.currency} minor units. The ledger distributes
            this figure across categories so the parts always sum to exactly this total.
          </Callout>
        </div>
      ) : null}

      {showAll && isLast && Object.keys(errors).length > 0 ? (
        <Callout tone="danger" title="A few fields need attention" live="assertive">
          {Object.values(errors).join(' ')}
        </Callout>
      ) : null}

      {step === 4 ? (
        <div className={styles.grid}>
          <Field
            label="Theme or vibe"
            hint="e.g. “midnight garden”, “neon nineties”."
            error={errors.theme}
          >
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

          <Field
            label="Considerations"
            hint="Dietary needs, accessibility, family politics, the things nobody may forget."
            error={errors.considerations}
          >
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

          <fieldset className={styles.priorities}>
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
      ) : null}

      <Rule />

      <footer className={styles.foot}>
        <div className={styles.footLeft}>
          {step > 0 ? (
            <Button variant="ghost" onClick={goBack}>
              ← Back
            </Button>
          ) : null}
          {onCancel ? (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
        <div className={styles.footRight}>
          {isLast ? (
            <Button variant="primary" size="lg" onClick={submit}>
              Draft my plan
            </Button>
          ) : (
            <Button variant="primary" onClick={goNext}>
              Continue →
            </Button>
          )}
        </div>
      </footer>
    </Sheet>
  );
}

/** Which wizard step owns a given brief key, for error navigation. */
function stepOwning(key: string): IntakeStepIndex {
  const map: Record<string, IntakeStepIndex> = {
    eventType: 0,
    date: 1,
    location: 1,
    guestCount: 2,
    budgetMinor: 3,
    currency: 3,
    theme: 4,
    considerations: 4,
    mustHaves: 4,
    avoid: 4,
    priorities: 4,
  };
  return map[key] ?? 0;
}
