'use client';

import { useState } from 'react';
import type { Plan, Vendor } from '@/lib/schemas/plan';
import { VENDOR_STATUS_LABELS, VENDOR_STATUS_ORDER, VENDOR_STATUS_TONES } from '@/lib/ui/labels';
import { minorUnitExponent, toMajorUnits, toMinorUnits } from '@/lib/domain/money';
import { computeLedger } from '@/lib/domain/budget';
import { Button } from '@/components/ui/Button';
import { Money } from '@/components/ui/Money';
import { Sheet } from '@/components/ui/Sheet';
import { Stamp } from '@/components/ui/Stamp';
import { EmptyState } from '@/components/ui/EmptyState';
import { Callout } from '@/components/ui/Callout';
import styles from './Roster.module.css';

export interface RosterProps {
  plan: Plan;
  onChange: (vendors: Vendor[]) => void;
  /** Ask the planner for questions/red flags for one vendor category. */
  onRequestTips: (categoryKey: string) => void;
  tipsBusyKey?: string | null;
}

/**
 * The vendor roster, laid out as a clipboard.
 *
 * Each vendor shows its quote against the *planned* amount for the linked
 * budget line, so a quote that blows the envelope is visible immediately rather
 * than discovered at the end. The AI's questions and red flags are advisory and
 * clearly attributed, never presented as fact.
 */
export function Roster({ plan, onChange, onRequestTips, tipsBusyKey }: RosterProps) {
  const ledger = ledgerFor(plan);
  const [openId, setOpenId] = useState<string | null>(plan.vendors[0]?.id ?? null);
  const exponent = minorUnitExponent(plan.brief.currency);
  const step = (1 / 10 ** exponent).toFixed(exponent);

  function patch(id: string, changes: Partial<Vendor>) {
    onChange(plan.vendors.map((vendor) => (vendor.id === id ? { ...vendor, ...changes } : vendor)));
  }

  function cycleStatus(vendor: Vendor, direction: 1 | -1) {
    const index = VENDOR_STATUS_ORDER.indexOf(vendor.status);
    const next =
      VENDOR_STATUS_ORDER[
        Math.min(VENDOR_STATUS_ORDER.length - 1, Math.max(0, index + direction))
      ] ?? vendor.status;
    patch(vendor.id, { status: next });
  }

  return (
    <Sheet className={styles.clipboard}>
      <div className={styles.clip} aria-hidden="true" />

      <header className={styles.head}>
        <div>
          <h3 className={styles.title}>The roster</h3>
          <p className={styles.sub}>
            Quotes are tracked against each category&apos;s planned amount. Nothing here commits
            money — it records what has actually been agreed.
          </p>
        </div>
      </header>

      {plan.vendors.length === 0 ? (
        <EmptyState title="No vendors on the roster yet">
          Vendors are seeded from the event type when a plan is created.
        </EmptyState>
      ) : (
        <ul className={styles.list}>
          {plan.vendors.map((vendor) => {
            const planned = vendor.budgetKey
              ? (ledger.rows.find((row) => row.key === vendor.budgetKey)?.plannedMinor ?? 0)
              : 0;
            const over = planned > 0 && vendor.quoteMinor > planned;
            const open = openId === vendor.id;
            const linked = vendor.budgetKey
              ? (ledger.rows.find((row) => row.key === vendor.budgetKey)?.label ?? vendor.budgetKey)
              : undefined;

            return (
              <li key={vendor.id} className={styles.item} data-print="avoid-break">
                <div className={styles.itemHead}>
                  <button
                    type="button"
                    className={styles.disclosure}
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : vendor.id)}
                  >
                    <span className={styles.categoryLabel}>{vendor.label}</span>
                    <Stamp tone={VENDOR_STATUS_TONES[vendor.status]} small>
                      {VENDOR_STATUS_LABELS[vendor.status]}
                    </Stamp>
                    <span className={styles.chevron} aria-hidden="true">
                      {open ? '▾' : '▸'}
                    </span>
                  </button>

                  <div className={styles.itemSummary}>
                    <span className={styles.vendorName}>{vendor.name || 'Not chosen yet'}</span>
                    <span className={styles.quote}>
                      <Money minor={vendor.quoteMinor} currency={plan.brief.currency} />
                      {planned > 0 ? (
                        <span className={styles.quoteOf}>
                          {' '}
                          of <Money minor={planned} currency={plan.brief.currency} />
                        </span>
                      ) : null}
                    </span>
                  </div>
                </div>

                {over ? (
                  <Callout tone="warn">
                    This quote is{' '}
                    <Money minor={vendor.quoteMinor - planned} currency={plan.brief.currency} />{' '}
                    above the {linked} line. Move money into that category in the ledger, or
                    renegotiate.
                  </Callout>
                ) : null}

                {open ? (
                  <div className={styles.detail}>
                    <div className={styles.fieldRow}>
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>Vendor</span>
                        <input
                          className={styles.input}
                          type="text"
                          maxLength={160}
                          value={vendor.name}
                          placeholder="Name"
                          onChange={(event) => patch(vendor.id, { name: event.target.value })}
                        />
                      </label>

                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>Quote ({plan.brief.currency})</span>
                        <input
                          className={styles.input}
                          type="number"
                          min={0}
                          step={step}
                          value={toMajorUnits(vendor.quoteMinor, plan.brief.currency)}
                          onChange={(event) => {
                            const parsed = Number.parseFloat(event.target.value);
                            patch(vendor.id, {
                              quoteMinor: Number.isFinite(parsed)
                                ? Math.max(0, toMinorUnits(parsed, plan.brief.currency))
                                : 0,
                            });
                          }}
                        />
                      </label>
                    </div>

                    <div className={styles.statusRow}>
                      <span className={styles.fieldLabel}>Status</span>
                      <div className={styles.statusButtons}>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => cycleStatus(vendor, -1)}
                          aria-label={`Move ${vendor.label} back a stage`}
                        >
                          ←
                        </Button>
                        {VENDOR_STATUS_ORDER.map((status) => (
                          <button
                            key={status}
                            type="button"
                            className={[
                              styles.statusChip,
                              vendor.status === status ? styles.statusOn : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            aria-pressed={vendor.status === status}
                            onClick={() => patch(vendor.id, { status })}
                          >
                            {VENDOR_STATUS_LABELS[status]}
                          </button>
                        ))}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => cycleStatus(vendor, 1)}
                          aria-label={`Move ${vendor.label} forward a stage`}
                        >
                          →
                        </Button>
                      </div>
                    </div>

                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Notes</span>
                      <textarea
                        className={styles.textarea}
                        rows={2}
                        maxLength={280}
                        value={vendor.notes}
                        placeholder="Contact details, deposit terms, anything to remember. Notes never appear in a shared link."
                        onChange={(event) => patch(vendor.id, { notes: event.target.value })}
                      />
                    </label>

                    {linked ? (
                      <p className={styles.linked}>
                        Counts against the <strong>{linked}</strong> budget line.
                      </p>
                    ) : null}

                    <VendorTips
                      vendor={vendor}
                      busy={tipsBusyKey === vendor.categoryKey}
                      onRequest={() => onRequestTips(vendor.categoryKey)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}

function VendorTips({
  vendor,
  busy,
  onRequest,
}: {
  vendor: Vendor;
  busy: boolean;
  onRequest: () => void;
}) {
  const hasTips = vendor.questions.length > 0 || vendor.redFlags.length > 0;

  return (
    <div className={styles.tips}>
      <div className={styles.tipsHead}>
        <span className={styles.fieldLabel}>Questions to ask &amp; red flags</span>
        <Button size="sm" variant="ghost" busy={busy} onClick={onRequest}>
          {hasTips ? 'Refresh from the planner' : 'Ask the planner'}
        </Button>
      </div>

      {!hasTips ? (
        <p className={styles.tipsEmpty}>
          No advice yet — the planner can suggest what to ask and what should worry you.
        </p>
      ) : (
        <>
          {vendor.tipsSource === 'seed' ? (
            <p className={styles.attribution}>Stock checklists for this category.</p>
          ) : vendor.tipsSource === 'ai' ? (
            <p className={styles.attribution}>Written by the planner for your brief.</p>
          ) : null}

          {vendor.questions.length > 0 ? (
            <ul className={styles.questionList}>
              {vendor.questions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>
          ) : null}

          {vendor.redFlags.length > 0 ? (
            <div className={styles.redFlags}>
              <p className={styles.redFlagTitle}>Watch out for</p>
              <ul className={styles.questionList}>
                {vendor.redFlags.map((flag) => (
                  <li key={flag}>{flag}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Ledger lookup so the roster can compare each quote with its planned line. */
function ledgerFor(plan: Plan) {
  return computeLedger(plan.brief, plan.budget.rows);
}
