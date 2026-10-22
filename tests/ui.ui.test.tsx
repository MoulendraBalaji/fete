/**
 * Component tests.
 *
 * These target the behaviours that are easy to break and expensive to notice:
 * that the intake cannot advance past an invalid step, that the ledger's totals
 * always equal the sum of its rows, and that the interactive primitives keep
 * their ARIA wiring. Styling and layout are deliberately not asserted — that is
 * what the design system is for.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IntakeWizard, emptyDraft } from '@/components/intake/IntakeWizard';
import { Ledger } from '@/components/workspace/Ledger';
import { Money } from '@/components/ui/Money';
import { Progress } from '@/components/ui/Progress';
import { Field } from '@/components/ui/Field';
import { Tabs } from '@/components/ui/Tabs';
import { Timeline } from '@/components/workspace/Timeline';
import { createPlan } from '@/lib/domain/plan';
import { computeLedger } from '@/lib/domain/budget';
import { WEDDING_BRIEF, TODAY_ISO } from '@/tests/fixtures';

const plan = createPlan(WEDDING_BRIEF, { todayIso: TODAY_ISO });

/* ------------------------------- Money ---------------------------------- */

describe('Money', () => {
  it('formats minor units with the currency and no floating-point drift', () => {
    render(<Money minor={120_050} currency="USD" />);
    expect(screen.getByText('$1,200.50')).toBeDefined();
  });

  it('formats a zero-decimal currency without digits', () => {
    render(<Money minor={250_000} currency="JPY" />);
    expect(screen.getByText('¥250,000')).toBeDefined();
  });

  it('renders a negative amount with a minus sign', () => {
    // The locale is pinned to en-US so server and client agree, hence `42.00`
    // rather than a locale-specific `42,00`.
    render(<Money minor={-4_200} currency="EUR" />);
    const el = screen.getByText(/42\.00/);
    expect(el.textContent?.startsWith('−')).toBe(true);
    expect(el.textContent).toBe('−€42.00');
  });

  it('shows an explicit plus only when signed is requested', () => {
    const { unmount } = render(<Money minor={500} currency="USD" signed />);
    expect(screen.getByText(/\$5\.00/).textContent?.startsWith('+')).toBe(true);
    unmount();

    render(<Money minor={500} currency="USD" />);
    expect(screen.getByText('$5.00').textContent?.startsWith('+')).toBe(false);
  });
});

/* ------------------------------ Progress -------------------------------- */

describe('Progress', () => {
  it('exposes the value through ARIA and clamps the bar width', () => {
    render(<Progress ratio={1.25} label="Budget committed" />);
    const bar = screen.getByRole('progressbar', { name: 'Budget committed' });
    expect(bar.getAttribute('aria-valuenow')).toBe('125');
    // The visible bar never overflows its track, even past 100%.
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('treats a non-finite ratio as zero rather than rendering NaN', () => {
    render(<Progress ratio={Number.NaN} label="Budget committed" />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });
});

/* -------------------------------- Field --------------------------------- */

describe('Field', () => {
  it('links the label, hint and error to the control', () => {
    render(
      <Field label="Event date" hint="A future date." error="Pick a date.">
        {({ id, describedBy, invalid }) => (
          <input id={id} aria-describedby={describedBy} aria-invalid={invalid} />
        )}
      </Field>,
    );

    const input = screen.getByLabelText('Event date');
    expect(input.getAttribute('aria-invalid')).toBe('true');

    const describedBy = input.getAttribute('aria-describedby') ?? '';
    expect(describedBy.split(' ')).toHaveLength(2);
    for (const id of describedBy.split(' ')) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    // The error is announced, not merely coloured.
    expect(screen.getByRole('alert').textContent).toBe('Pick a date.');
  });

  it('marks a valid field invalid=false and omits the description', () => {
    render(
      <Field label="Location">
        {({ id, describedBy, invalid }) => (
          <input id={id} aria-describedby={describedBy} aria-invalid={invalid} />
        )}
      </Field>,
    );
    const input = screen.getByLabelText('Location');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(input.getAttribute('aria-describedby')).toBeNull();
  });
});

/* -------------------------------- Tabs ---------------------------------- */

describe('Tabs', () => {
  const items = [
    { id: 'a', label: 'Ledger', panel: <p>Ledger panel</p> },
    { id: 'b', label: 'Timeline', panel: <p>Timeline panel</p> },
    { id: 'c', label: 'Roster', panel: <p>Roster panel</p> },
  ];

  it('exposes the tab roles and marks the active tab selected', () => {
    render(<Tabs items={items} activeId="b" onChange={() => {}} label="Plan sections" />);
    const tablist = screen.getByRole('tablist', { name: 'Plan sections' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('false');
  });

  it('uses a roving tabindex so only the active tab is in the tab order', () => {
    render(<Tabs items={items} activeId="b" onChange={() => {}} label="Plan sections" />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
  });

  it('moves to the next tab with ArrowRight and reports the change', async () => {
    const onChange = vi.fn();
    render(<Tabs items={items} activeId="a" onChange={onChange} label="Plan sections" />);
    const first = screen.getByRole('tab', { name: 'Ledger' });
    first.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('wraps from the last tab to the first with ArrowRight', async () => {
    const onChange = vi.fn();
    render(<Tabs items={items} activeId="c" onChange={onChange} label="Plan sections" />);
    screen.getByRole('tab', { name: 'Roster' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('jumps to the ends with Home and End', async () => {
    const onChange = vi.fn();
    render(<Tabs items={items} activeId="b" onChange={onChange} label="Plan sections" />);
    screen.getByRole('tab', { name: 'Timeline' }).focus();
    await userEvent.keyboard('{End}');
    expect(onChange).toHaveBeenCalledWith('c');
    await userEvent.keyboard('{Home}');
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('hides inactive panels but keeps them mounted so edits survive', () => {
    render(<Tabs items={items} activeId="a" onChange={() => {}} label="Plan sections" />);
    // Both panels exist in the DOM; only the inactive one is hidden.
    expect(screen.getByText('Ledger panel')).toBeDefined();
    const inactive = screen.getByText('Timeline panel').closest('[role="tabpanel"]');
    expect(inactive?.hasAttribute('hidden')).toBe(true);
  });

  it('puts only the visible panel in the tab order', () => {
    render(<Tabs items={items} activeId="a" onChange={() => {}} label="Plan sections" />);
    const panels = screen.getAllByRole('tabpanel', { hidden: true });
    const active = panels.find((panel) => !panel.hasAttribute('hidden'));
    expect(active?.getAttribute('tabindex')).toBe('0');
    for (const panel of panels.filter((entry) => entry.hasAttribute('hidden'))) {
      expect(panel.getAttribute('tabindex')).toBe('-1');
    }
  });

  it('renders no panel at all for a tab that was never opened', () => {
    // `Workspace` passes `panel: null` for tabs the user has not visited; an
    // empty `tabpanel` here would be an unreachable landmark for a screen reader.
    const lazy = [
      { id: 'a', label: 'Ledger', panel: <p>Ledger panel</p> },
      { id: 'b', label: 'Timeline', panel: null },
    ];
    render(<Tabs items={lazy} activeId="a" onChange={() => {}} label="Plan sections" />);
    expect(screen.getAllByRole('tabpanel', { hidden: true })).toHaveLength(1);
    // The *tab* still exists, so keyboard users can reach it to load the panel.
    expect(screen.getByRole('tab', { name: 'Timeline' })).toBeDefined();
  });
});

/* ------------------------------ Timeline -------------------------------- */

describe('Timeline reordering', () => {
  const base = createPlan(WEDDING_BRIEF, { todayIso: TODAY_ISO, id: 'plan-timeline-01' });

  /** A plan with two milestones sharing a due date, so a move is meaningful. */
  const orderedPlan = {
    ...base,
    timeline: {
      items: [
        {
          id: 'move-aaa111',
          phase: 'milestone' as const,
          title: 'Book the venue',
          detail: '',
          dueDate: '2026-11-01',
          done: false,
          order: 0,
          compressed: false,
        },
        {
          id: 'move-bbb222',
          phase: 'milestone' as const,
          title: 'Choose the caterer',
          detail: '',
          dueDate: '2026-11-01',
          done: false,
          order: 1,
          compressed: false,
        },
      ],
    },
  };

  function renderTimeline(onMove: (id: string, direction: 'up' | 'down') => void) {
    return render(
      <Timeline
        plan={orderedPlan}
        todayIso={TODAY_ISO}
        onToggleDone={() => {}}
        onMove={onMove}
        onExportIcs={() => {}}
      />,
    );
  }

  it('offers labelled move controls, not drag-only handles', () => {
    renderTimeline(() => {});
    expect(screen.getByRole('button', { name: 'Move “Choose the caterer” earlier' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Move “Choose the caterer” later' })).toBeDefined();
  });

  it('reports a move with the direction and the item id', async () => {
    const onMove = vi.fn();
    renderTimeline(onMove);
    await userEvent.click(screen.getByRole('button', { name: 'Move “Choose the caterer” earlier' }));
    expect(onMove).toHaveBeenCalledWith('move-bbb222', 'up');
  });

  it('disables moving the first item earlier and the last item later', () => {
    renderTimeline(() => {});
    const up = screen.getByRole('button', {
      name: 'Move “Book the venue” earlier',
    }) as HTMLButtonElement;
    const down = screen.getByRole('button', {
      name: 'Move “Choose the caterer” later',
    }) as HTMLButtonElement;
    // A control that cannot do anything must not offer to do it.
    expect(up.disabled).toBe(true);
    expect(down.disabled).toBe(true);
  });

  it('is operable from the keyboard alone', async () => {
    const onMove = vi.fn();
    renderTimeline(onMove);
    const button = screen.getByRole('button', { name: 'Move “Choose the caterer” earlier' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(onMove).toHaveBeenCalledWith('move-bbb222', 'up');
  });
});

/* ---------------------------- IntakeWizard ------------------------------ */

describe('IntakeWizard', () => {
  it('starts on step 1 of 5 and shows the first question', () => {
    render(<IntakeWizard onComplete={() => {}} />);
    expect(screen.getByText('Step 1 of 5')).toBeDefined();
    expect(screen.getByRole('radiogroup', { name: 'Event type' })).toBeDefined();
  });

  it('blocks Continue when the current step is invalid, and shows the error', async () => {
    render(<IntakeWizard onComplete={() => {}} />);

    // Step 1 (event type) is prefilled, so advance to step 2 (date + location).
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByText('Step 2 of 5')).toBeDefined();

    // Continue with the date and location both empty: must not advance.
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByText('Step 2 of 5')).toBeDefined();
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });

  it('advances once the step is valid and reaches the final step', async () => {
    render(<IntakeWizard onComplete={() => {}} />);

    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await userEvent.type(screen.getByLabelText(/Event date/), '2027-06-19');
    await userEvent.type(screen.getByLabelText(/Location/), 'Lisbon');
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByText('Step 3 of 5')).toBeDefined();

    await userEvent.type(screen.getByLabelText(/Expected guests/), '90');
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByText('Step 4 of 5')).toBeDefined();

    await userEvent.type(screen.getByLabelText(/Total budget/), '24000');
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect(screen.getByText('Step 5 of 5')).toBeDefined();
    expect(screen.getByRole('button', { name: /Draft my plan/ })).toBeDefined();
  });

  it('produces a schema-valid brief with the budget converted to minor units', async () => {
    const onComplete = vi.fn();
    render(<IntakeWizard onComplete={onComplete} />);

    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await userEvent.type(screen.getByLabelText(/Event date/), '2027-06-19');
    await userEvent.type(screen.getByLabelText(/Location/), 'Lisbon');
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await userEvent.type(screen.getByLabelText(/Expected guests/), '90');
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await userEvent.type(screen.getByLabelText(/Total budget/), '24000');
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await userEvent.click(screen.getByRole('button', { name: /Draft my plan/ }));

    expect(onComplete).toHaveBeenCalledTimes(1);
    const brief = onComplete.mock.calls[0]?.[0] as { budgetMinor: number; currency: string };
    // 24,000 major units in USD is exactly 2,400,000 minor units — no float.
    expect(brief.budgetMinor).toBe(2_400_000);
    expect(brief.currency).toBe('USD');
    expect(Number.isInteger(brief.budgetMinor)).toBe(true);
  });

  it('will not submit a zero budget', async () => {
    const onComplete = vi.fn();
    render(<IntakeWizard onComplete={onComplete} />);

    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await userEvent.type(screen.getByLabelText(/Event date/), '2027-06-19');
    await userEvent.type(screen.getByLabelText(/Location/), 'Lisbon');
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await userEvent.type(screen.getByLabelText(/Expected guests/), '90');
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));
    await userEvent.type(screen.getByLabelText(/Total budget/), '0');
    await userEvent.click(screen.getByRole('button', { name: /Continue/ }));

    // Still on the budget step, and no plan was produced.
    expect(screen.getByText('Step 4 of 5')).toBeDefined();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('lets a sample prefill the draft', () => {
    render(<IntakeWizard initial={{ ...emptyDraft(), location: 'Porto' }} onComplete={() => {}} />);
    expect(screen.getByText('Step 1 of 5')).toBeDefined();
    // The prefill is visible once the wizard reaches the step that owns it.
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    expect((screen.getByLabelText(/Location/) as HTMLInputElement).value).toBe('Porto');
  });
});

/* -------------------------------- Ledger -------------------------------- */

describe('Ledger', () => {
  /**
   * Rows carry only `key`/amounts; the human label is derived by
   * `computeLedger`. Tests read it from there so they exercise the same path
   * the component does.
   */
  const ledgerRows = computeLedger(plan.brief, plan.budget.rows).rows;
  const first = ledgerRows[0];
  if (!first) throw new Error('fixture produced no budget rows');

  it('renders the seeded rows and totals that reconcile with the brief', () => {
    render(<Ledger brief={plan.brief} rows={plan.budget.rows} onChange={() => {}} />);

    // The summary shows the brief's total budget.
    expect(screen.getByText('Total budget')).toBeDefined();

    const ledger = computeLedger(plan.brief, plan.budget.rows);
    // The computed envelope is the brief's budget, to the minor unit.
    expect(ledger.totalMinor).toBe(plan.brief.budgetMinor);
    // Every category from the template is on screen, by its derived label.
    for (const row of ledger.rows) {
      expect(screen.getByText(row.label)).toBeDefined();
    }
  });

  it('keeps planned rows within the envelope after seeding', () => {
    const ledger = computeLedger(plan.brief, plan.budget.rows);
    // Seeding must never promise more than the brief allows.
    expect(ledger.unallocatedMinor).toBeGreaterThanOrEqual(0);
    // And a reserve must exist — the brief asks for one.
    expect(ledger.rows.some((row) => row.contingency)).toBe(true);
  });

  it('flags an over-allocation instead of silently absorbing it', () => {
    // Push every row's planned amount past the envelope.
    const inflated = plan.budget.rows.map((row) => ({
      ...row,
      plannedMinor: row.plannedMinor * 3,
    }));
    render(<Ledger brief={plan.brief} rows={inflated} onChange={() => {}} />);
    expect(screen.getByText('The plan is over budget')).toBeDefined();
  });

  it('saves an edited planned amount as integer minor units', async () => {
    const onChange = vi.fn();
    render(<Ledger brief={plan.brief} rows={plan.budget.rows} onChange={onChange} />);

    // Click the planned amount to open the inline editor.
    await userEvent.click(screen.getByTitle(`Edit planned amount for ${first.label}`));
    const input = await screen.findByLabelText(`Planned amount for ${first.label}`);
    await userEvent.clear(input);
    await userEvent.type(input, '1234.56');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const rows = onChange.mock.calls[0]?.[0] as Array<{ key: string; plannedMinor: number }>;
    const edited = rows.find((row) => row.key === first.key);
    // 1,234.56 USD becomes exactly 123456 minor units — no float residue.
    expect(edited?.plannedMinor).toBe(123_456);
    expect(Number.isInteger(edited?.plannedMinor)).toBe(true);
  });

  it('cancels an edit without changing the rows', async () => {
    const onChange = vi.fn();
    render(<Ledger brief={plan.brief} rows={plan.budget.rows} onChange={onChange} />);

    await userEvent.click(screen.getByTitle(`Edit planned amount for ${first.label}`));
    const input = await screen.findByLabelText(`Planned amount for ${first.label}`);
    await userEvent.clear(input);
    await userEvent.type(input, '99');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onChange).not.toHaveBeenCalled();
    // The original amount is back on screen.
    expect(screen.getByTitle(`Edit planned amount for ${first.label}`)).toBeDefined();
  });

  it('marks the contingency reserve as protected', () => {
    render(<Ledger brief={plan.brief} rows={plan.budget.rows} onChange={() => {}} />);
    expect(screen.getByText('Protected')).toBeDefined();
  });

  it('clamps a negative typed amount to zero', async () => {
    const onChange = vi.fn();
    render(<Ledger brief={plan.brief} rows={plan.budget.rows} onChange={onChange} />);

    const actual = screen.getByLabelText(`Actual amount for ${first.label}`);
    await userEvent.clear(actual);
    await userEvent.type(actual, '-50');
    await userEvent.tab();

    expect(onChange).toHaveBeenCalled();
    const rows = onChange.mock.calls.at(-1)?.[0] as Array<{ key: string; actualMinor: number }>;
    const edited = rows.find((row) => row.key === first.key);
    expect(edited?.actualMinor).toBe(0);
  });
});
