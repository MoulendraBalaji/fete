'use client';

import { useState } from 'react';
import type { PlanSummary } from '@/lib/schemas/plan';
import { EVENT_TYPE_LABELS } from '@/lib/ui/labels';
import { formatPlanDate } from '@/lib/domain/plan';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { Stamp } from '@/components/ui/Stamp';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from './PlanLibrary.module.css';

export interface PlanLibraryProps {
  plans: readonly PlanSummary[];
  activeId: string | null;
  onCreate: () => void;
  onOpen: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onImport: (file: File) => void;
  onExport: (id: string) => void;
}

/**
 * The plan library: every plan stored on this device.
 *
 * There is no account, so this list *is* the user's data. Deleting asks for
 * confirmation inline (not via `window.confirm`, which cannot be styled and
 * blocks the main thread), and import is a file picker rather than a paste box.
 */
export function PlanLibrary({
  plans,
  activeId,
  onCreate,
  onOpen,
  onDuplicate,
  onDelete,
  onImport,
  onExport,
}: PlanLibraryProps) {
  return (
    <Sheet className={styles.library}>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Your plans</h2>
          <p className={styles.sub}>
            Stored in this browser only. Nothing is uploaded, and clearing your site data removes
            them.
          </p>
        </div>
        <div className={styles.headActions}>
          <label className={styles.fileLabel}>
            Import JSON
            <input
              type="file"
              accept="application/json,.json"
              className="srOnly"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onImport(file);
                // Reset so selecting the same file twice still fires.
                event.target.value = '';
              }}
            />
          </label>
          <Button variant="primary" onClick={onCreate}>
            New plan
          </Button>
        </div>
      </header>

      {plans.length === 0 ? (
        <EmptyState
          title="No plans on this device yet"
          action={
            <Button variant="primary" onClick={onCreate}>
              Start a plan
            </Button>
          }
        >
          Answer five short questions and the planner will draft a budget, a countdown and a roster.
        </EmptyState>
      ) : (
        <ul className={styles.list}>
          {plans.map((plan) => (
            <li key={plan.id} className={styles.row}>
              <button
                type="button"
                className={styles.open}
                onClick={() => onOpen(plan.id)}
                aria-current={plan.id === activeId ? 'true' : undefined}
              >
                <span className={styles.name}>{plan.name}</span>
                <span className={styles.meta}>
                  <Stamp tone="neutral" small>
                    {EVENT_TYPE_LABELS[plan.eventType]}
                  </Stamp>
                  <span className={`mono ${styles.date}`}>{formatPlanDate(plan.date)}</span>
                </span>
              </button>

              <div className={styles.rowActions}>
                <Button size="sm" variant="ghost" onClick={() => onDuplicate(plan.id)}>
                  Duplicate
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onExport(plan.id)}>
                  Export
                </Button>
                <ConfirmDelete onConfirm={() => onDelete(plan.id)} label={plan.name} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

/** Two-step delete: the second click is the confirmation. */
function ConfirmDelete({ onConfirm, label }: { onConfirm: () => void; label: string }) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setArmed(true)}
        aria-label={`Delete ${label}`}
      >
        Delete
      </Button>
    );
  }

  return (
    <span className={styles.confirm}>
      <Button size="sm" variant="danger" onClick={onConfirm}>
        Really delete
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setArmed(false)}>
        Keep
      </Button>
    </span>
  );
}
