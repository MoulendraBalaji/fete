'use client';

import { useMemo, useState } from 'react';
import type { Brief } from '@/lib/schemas/brief';
import type { BudgetRow } from '@/lib/schemas/plan';
import { computeLedger } from '@/lib/domain/budget';
import { minorUnitExponent, toMajorUnits, toMinorUnits } from '@/lib/domain/money';
import { Button } from '@/components/ui/Button';
import { Money } from '@/components/ui/Money';
import { Progress } from '@/components/ui/Progress';
import { Rule } from '@/components/ui/Rule';
import { Sheet } from '@/components/ui/Sheet';
import { Callout } from '@/components/ui/Callout';
import { Stamp } from '@/components/ui/Stamp';
import styles from './Ledger.module.css';

export interface LedgerProps {
  brief: Brief;
  rows: BudgetRow[];
  onChange: (rows: BudgetRow[]) => void;
  /** Rendered inside the "ask for advice" area when the user requests help. */
  advice?: React.ReactNode;
  onRequestAdvice?: () => void;
  adviceBusy?: boolean;
}

/**
 * The budget ledger.
 *
 * Editing rules that keep the books honest:
 *  - Every amount typed is converted to integer minor units immediately, so a
 *    float never enters the model.
 *  - The *planned* column is what the user may edit; the running total plus the
 *    contingency reserve are shown continuously, and an over-allocation is
 *    flagged rather than silently absorbed.
 *  - The contingency row is marked and explained: it is the one row the
 *    assistant is forbidden from spending.
 */
export function Ledger({
  brief,
  rows,
  onChange,
  advice,
  onRequestAdvice,
  adviceBusy,
}: LedgerProps) {
  const ledger = useMemo(() => computeLedger(brief, rows), [brief, rows]);
  const [editing, setEditing] = useState<string | null>(null);

  const exponent = minorUnitExponent(brief.currency);
  const step = (1 / 10 ** exponent).toFixed(exponent);

  function updateRow(key: string, field: 'plannedMinor' | 'actualMinor', major: string) {
    const parsed = Number.parseFloat(major);
    const minor = Number.isFinite(parsed) ? Math.max(0, toMinorUnits(parsed, brief.currency)) : 0;
    onChange(rows.map((row) => (row.key === key ? { ...row, [field]: minor } : row)));
  }

  const overallocated = ledger.unallocatedMinor < 0;
  const spentRatio =
    ledger.plannedTotalMinor > 0 ? ledger.actualTotalMinor / ledger.plannedTotalMinor : 0;

  return (
    <div className={styles.wrap}>
      <Sheet className={styles.summary} tone="inset" printable={false}>
        <div className={styles.summaryGrid}>
          <Stat label="Total budget" amount={ledger.totalMinor} currency={brief.currency} />
          <Stat label="Planned" amount={ledger.plannedTotalMinor} currency={brief.currency} />
          <Stat
            label="Spent / committed"
            amount={ledger.actualTotalMinor}
            currency={brief.currency}
          />
          <Stat
            label={overallocated ? 'Over-allocated' : 'Unallocated'}
            amount={Math.abs(ledger.unallocatedMinor)}
            currency={brief.currency}
            tone={overallocated ? 'danger' : 'stamp'}
          />
        </div>

        <Progress
          label="Budget committed"
          ratio={spentRatio}
          tone={spentRatio > 1 ? 'danger' : 'stamp'}
        />

        {overallocated ? (
          <Callout tone="warn" title="The plan is over budget">
            Promised {formatDelta(Math.abs(ledger.unallocatedMinor), brief.currency)} more than the
            total. Trim a category, or raise the total in the brief and the rows will re-seed.
          </Callout>
        ) : null}

        {!overallocated && ledger.unallocatedMinor > 0 ? (
          <Callout tone="note" title="Money still to place">
            {formatDelta(ledger.unallocatedMinor, brief.currency)} is not yet assigned to a
            category. Assigning it now — especially to the reserve — makes the plan resilient.
          </Callout>
        ) : null}
      </Sheet>

      <Sheet>
        <header className={styles.head}>
          <h3 className={styles.title}>Where the money goes</h3>
          {onRequestAdvice ? (
            <Button variant="ghost" size="sm" busy={adviceBusy} onClick={onRequestAdvice}>
              Ask the planner to review this
            </Button>
          ) : null}
        </header>

        <table className={styles.table}>
          <caption className="srOnly">
            Budget categories with planned and actual amounts in {brief.currency}
          </caption>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col" className={styles.numeric}>
                Share
              </th>
              <th scope="col" className={styles.numeric}>
                Planned
              </th>
              <th scope="col" className={styles.numeric}>
                Actual
              </th>
              <th scope="col" className={styles.numeric}>
                Left
              </th>
            </tr>
          </thead>
          <tbody>
            {ledger.rows.map((row) => {
              const remaining = row.plannedMinor - row.actualMinor;
              const isEditing = editing === row.key;
              return (
                <tr key={row.key} className={row.contingency ? styles.reserve : ''}>
                  <th scope="row" className={styles.category}>
                    <span className={styles.catLabel}>
                      {row.label}
                      {row.contingency ? (
                        <Stamp tone="gold" small>
                          Protected
                        </Stamp>
                      ) : null}
                    </span>
                    <span className={styles.catHint}>{row.hint}</span>
                  </th>
                  <td className={styles.numeric}>
                    <span className={`mono ${styles.share}`}>
                      {(row.shareBps / 100).toFixed(1)}%
                    </span>
                  </td>
                  <td className={styles.numeric}>
                    {isEditing ? (
                      <AmountInput
                        value={toMajorUnits(row.plannedMinor, brief.currency)}
                        step={step}
                        label={`Planned amount for ${row.label}`}
                        onCommit={(value) => {
                          updateRow(row.key, 'plannedMinor', value);
                          setEditing(null);
                        }}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <button
                        type="button"
                        className={styles.amountButton}
                        onClick={() => setEditing(row.key)}
                        title={`Edit planned amount for ${row.label}`}
                      >
                        <Money minor={row.plannedMinor} currency={brief.currency} />
                      </button>
                    )}
                  </td>
                  <td className={styles.numeric}>
                    <AmountField
                      value={toMajorUnits(row.actualMinor, brief.currency)}
                      step={step}
                      label={`Actual amount for ${row.label}`}
                      onCommit={(value) => updateRow(row.key, 'actualMinor', value)}
                    />
                  </td>
                  <td className={styles.numeric}>
                    <Money minor={remaining} currency={brief.currency} toneBySign signed />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td className={styles.numeric}>
                <span className={`mono ${styles.share}`}>100.0%</span>
              </td>
              <td className={styles.numeric}>
                <Money minor={ledger.plannedTotalMinor} currency={brief.currency} />
              </td>
              <td className={styles.numeric}>
                <Money minor={ledger.actualTotalMinor} currency={brief.currency} />
              </td>
              <td className={styles.numeric}>
                <Money minor={ledger.remainingMinor} currency={brief.currency} toneBySign signed />
              </td>
            </tr>
          </tfoot>
        </table>

        <Rule />

        <p className={styles.footnote}>
          Amounts are whole {brief.currency} minor units. Category shares are re-derived from the
          amounts after every edit, so the column of percentages and the column of money never
          disagree.
        </p>
      </Sheet>

      {advice ? <div>{advice}</div> : null}
    </div>
  );
}

function Stat({
  label,
  amount,
  currency,
  tone = 'plain',
}: {
  label: string;
  amount: number;
  currency: string;
  tone?: 'plain' | 'stamp' | 'danger';
}) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={[styles.statValue, styles[tone]].filter(Boolean).join(' ')}>
        <Money minor={amount} currency={currency} />
      </span>
    </div>
  );
}

/** Commits on blur or Enter so the table is not re-rendered per keystroke. */
function AmountField({
  value,
  step,
  label,
  onCommit,
}: {
  value: number;
  step: string;
  label: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value.toFixed(2));

  return (
    <input
      className={styles.amountInput}
      type="number"
      min={0}
      step={step}
      aria-label={label}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/** Inline editor for the planned column, with explicit commit/cancel. */
function AmountInput({
  value,
  step,
  label,
  onCommit,
  onCancel,
}: {
  value: number;
  step: string;
  label: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value.toFixed(2));
  return (
    <span className={styles.inlineEdit}>
      {/* Autofocus is intentional: the user just clicked "edit". */}
      <input
        className={styles.amountInput}
        type="number"
        min={0}
        step={step}
        aria-label={label}
        value={draft}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onCommit(draft);
          if (event.key === 'Escape') onCancel();
        }}
      />
      <Button size="sm" variant="primary" onClick={() => onCommit(draft)}>
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </span>
  );
}

function formatDelta(minor: number, currency: string): string {
  const exponent = minorUnitExponent(currency);
  const amount = (minor / 10 ** exponent).toLocaleString('en-US', {
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  });
  return `${amount} ${currency}`;
}
