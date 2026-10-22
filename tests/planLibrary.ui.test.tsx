/**
 * `usePlanLibrary` persistence tests.
 *
 * The hook is the only thing that writes `localStorage`, and Stage 5 changed how
 * often it does so: edits are coalesced into one write per idle burst instead of
 * one per keystroke. That change is only safe if the write still *always*
 * happens, so these tests pin the contract rather than the implementation:
 *
 *   1. a burst of edits produces a single write, and the value written is the
 *      latest one (never an earlier keystroke resurrected);
 *   2. a pending write is flushed when the page is hidden, so nothing is lost;
 *   3. structural edits still write through immediately.
 *
 * Counting `setItem` calls is deliberate — it measures the cost that motivated
 * the change, and it would catch a regression that reintroduced a per-render
 * write even if every value were correct.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePlanLibrary } from '@/lib/hooks/usePlanLibrary';
import { createPlan } from '@/lib/domain/plan';
import { STORAGE_KEY, readEnvelope, replaceAll, browserStorage } from '@/lib/storage/plans';
import { TODAY_ISO, WEDDING_BRIEF } from '@/tests/fixtures';

/** A plan whose name is easy to mutate one character at a time. */
function seedPlan(id: string) {
  return createPlan(WEDDING_BRIEF, { todayIso: TODAY_ISO, id, now: 1_700_000_000_000 });
}

/** Runs `fn` and advances the debounce timer past its 300 ms window. */
function advance(ms: number) {
  vi.advanceTimersByTime(ms);
}

describe('usePlanLibrary persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers({ shouldAdvanceTime: false });
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
  });

  it('coalesces a burst of edits into a single write', () => {
    const plan = seedPlan('plan-burst-0001');
    replaceAll(browserStorage(), [plan]);

    const { result } = renderHook(() => usePlanLibrary());

    // Mount reads storage once; start counting only the writes made from here.
    //
    // The spy must be installed on `Storage.prototype`: jsdom's `localStorage`
    // is a proxy whose `setItem` is not an own property, so spying on the
    // instance silently records nothing and would let a per-keystroke write
    // pass unnoticed.
    const setItem = vi.spyOn(Object.getPrototypeOf(window.localStorage) as Storage, 'setItem');

    act(() => {
      for (let step = 0; step < 20; step += 1) {
        result.current.updateActive((current) => ({ ...current, name: `Plan ${step}` }));
      }
    });

    // Nothing is written while the burst is still in flight.
    expect(setItem).not.toHaveBeenCalled();

    act(() => {
      advance(400);
    });

    // One flush for twenty keystrokes. The flush performs two storage writes —
    // the plan envelope and the active id — and both are necessary; what matters
    // is that the count is constant in the number of keystrokes, not 20.
    expect(setItem).toHaveBeenCalledTimes(2);
    const stored = readEnvelope(browserStorage());
    expect(stored.plans[0]?.name).toBe('Plan 19');

    setItem.mockRestore();
  });

  it('flushes a pending edit when the page is hidden', () => {
    const plan = seedPlan('plan-flush-0002');
    replaceAll(browserStorage(), [plan]);

    const { result } = renderHook(() => usePlanLibrary());

    act(() => {
      result.current.updateActive((current) => ({ ...current, name: 'Unsaved keystrokes' }));
    });

    // The edit is in memory but not yet on disk.
    expect(readEnvelope(browserStorage()).plans[0]?.name).not.toBe('Unsaved keystrokes');

    // Hiding the tab must not lose it — this is the guarantee that makes
    // removing synchronous writes acceptable.
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });

    expect(readEnvelope(browserStorage()).plans[0]?.name).toBe('Unsaved keystrokes');
  });

  it('flushes a pending edit on unmount, so a route change loses nothing', () => {
    const plan = seedPlan('plan-unmount-0003');
    replaceAll(browserStorage(), [plan]);

    const { result, unmount } = renderHook(() => usePlanLibrary());

    act(() => {
      result.current.updateActive((current) => ({ ...current, name: 'Last keystroke' }));
    });

    unmount();

    expect(readEnvelope(browserStorage()).plans[0]?.name).toBe('Last keystroke');
  });

  it('writes structural edits through immediately, without waiting for the timer', () => {
    const first = seedPlan('plan-struct-0004');
    const second = seedPlan('plan-struct-0005');
    replaceAll(browserStorage(), [first]);

    const { result } = renderHook(() => usePlanLibrary());

    act(() => {
      result.current.add(second);
    });

    // No timer advanced: `add` must already be durable.
    const stored = readEnvelope(browserStorage());
    expect(stored.plans.map((candidate) => candidate.id)).toContain(second.id);

    act(() => {
      result.current.remove(second.id);
    });

    expect(readEnvelope(browserStorage()).plans.map((p) => p.id)).not.toContain(second.id);
  });

  it('does not resurrect a structural change when a pending edit flushes later', () => {
    const plan = seedPlan('plan-race-0006');
    replaceAll(browserStorage(), [plan]);

    const { result } = renderHook(() => usePlanLibrary());

    // A debounced edit is in flight...
    act(() => {
      result.current.updateActive((current) => ({ ...current, name: 'Edited' }));
    });

    // ...then a structural edit arrives before the timer fires.
    act(() => {
      result.current.add(seedPlan('plan-race-0007'));
    });

    act(() => {
      advance(400);
    });

    // Both must survive: the rename applied to the first plan, the second plan
    // present. A naive flush that wrote a stale snapshot would drop one.
    const stored = readEnvelope(browserStorage());
    expect(stored.plans).toHaveLength(2);
    expect(stored.plans.find((p) => p.id === plan.id)?.name).toBe('Edited');
  });

  it('keeps the active plan pointing at the plan the user is on', () => {
    const first = seedPlan('plan-active-0008');
    const second = seedPlan('plan-active-0009');
    replaceAll(browserStorage(), [first, second]);

    const { result } = renderHook(() => usePlanLibrary());

    act(() => {
      result.current.setActive(second.id);
    });

    act(() => {
      result.current.updateActive((current) => ({ ...current, name: 'Renamed target' }));
    });

    // Scheduled in the tick above, fired in this one.
    act(() => {
      advance(400);
    });

    const stored = readEnvelope(browserStorage());
    expect(stored.activeId).toBe(second.id);
    expect(stored.plans.find((p) => p.id === second.id)?.name).toBe('Renamed target');
    // The plan that was *not* active is untouched.
    expect(stored.plans.find((p) => p.id === first.id)?.name).toBe(first.name);
  });

  it('writes nothing at all when there is nothing to save', () => {
    // An empty library must not produce a write on mount; a stray write here is
    // how a fresh visit would clobber another tab's data.
    const before = window.localStorage.getItem(STORAGE_KEY);
    renderHook(() => usePlanLibrary());
    act(() => {
      advance(400);
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(before);
  });
});
