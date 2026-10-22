'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Plan, PlanSummary } from '@/lib/schemas/plan';
import {
  browserStorage,
  readEnvelope,
  replaceAll,
  setActiveId,
} from '@/lib/storage/plans';
import { duplicatePlan } from '@/lib/domain/plan';
import { fromImportJson, toExportJson } from '@/lib/share/encode';
import { downloadText } from '@/lib/client/browser';

export type NoticeTone = 'info' | 'success' | 'danger';

/**
 * How long a burst of edits is allowed to coalesce before it is persisted.
 *
 * A budget row or vendor name is edited character by character, and each
 * mutation previously ran a full read → parse → validate → stringify → write of
 * the entire plan library. With a few dozen plans that is six figures of JSON
 * parsing per keystroke, on the main thread, for a change the user cannot see.
 * Coalescing to one write per idle burst removes that cost without changing what
 * is stored.
 *
 * Correctness rests on the flush below, not on the timer being prompt: a pending
 * write is forced out before unload and on unmount, so the "no save button,
 * nothing is ever lost" promise still holds.
 */
const PERSIST_DEBOUNCE_MS = 300;

export interface LibraryNotice {
  message: string;
  tone: NoticeTone;
  /** Present only when the action that produced the notice is reversible. */
  undo?: () => void;
}

export interface PlanLibraryApi {
  ready: boolean;
  plans: Plan[];
  summaries: PlanSummary[];
  activeId: string | null;
  /** The plan the user is working on. */
  activePlan: Plan | null;
  notice: LibraryNotice | null;
  dismissNotice: () => void;
  notify: (notice: LibraryNotice) => void;
  setActive: (id: string) => void;
  /** Inserts a plan and makes it active, e.g. after intake completes. */
  add: (plan: Plan) => void;
  /** Replaces a plan in place (already validated by the caller). */
  put: (plan: Plan) => void;
  /** Mutates the active plan and persists the result. */
  updateActive: (mutate: (plan: Plan) => Plan) => void;
  duplicate: (id: string) => void;
  remove: (id: string) => void;
  importFile: (file: File) => Promise<void>;
  exportPlan: (id: string) => void;
}

/**
 * Owns the plan library: the single place that reads and writes `localStorage`,
 * so no component ever touches storage directly.
 *
 * Writes are debounced (see `PERSIST_DEBOUNCE_MS`) but never *dropped*: the
 * in-memory state is authoritative and always current, a pending write is
 * flushed before the page unloads, and structural edits (add, delete, duplicate,
 * import, activate) write through immediately because they are rare, discrete
 * and the ones a user would most hate to lose.
 *
 * Because a mutation cannot be undone by the browser, deletion keeps the removed
 * plan in state and exposes it through the notice's `undo`, so a mis-click is
 * always recoverable.
 */
export function usePlanLibrary(initial?: Plan): PlanLibraryApi {
  const [ready, setReady] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [notice, setNotice] = useState<LibraryNotice | null>(null);

  /**
   * The library as it should be in storage. Debounced writes persist this rather
   * than closing over a render's `plans`, so a coalesced write can never
   * resurrect a value a newer keystroke already replaced.
   */
  const latest = useRef<Plan[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /**
   * Mirrors `activeId` for code that must read it without depending on it.
   *
   * The unload listeners and the debounce timer are installed once; if they
   * closed over `activeId` they would be torn down and re-added on every plan
   * switch, and a timer scheduled before the switch would write the old id.
   */
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;

  /**
   * The single write path. Writes the whole library because that is what the
   * storage envelope holds, and restores `activeId` because `replaceAll` would
   * otherwise reset it to the first plan in the list.
   */
  const persist = useCallback((next: Plan[]) => {
    const storage = browserStorage();
    replaceAll(storage, next);
    const id = activeIdRef.current;
    if (id) setActiveId(storage, id);
  }, []);

  /**
   * Writes any pending edit immediately. Called before unload so a debounced
   * save cannot be lost, and by structural edits so they do not race the timer.
   */
  const flush = useCallback(() => {
    if (timer.current === undefined) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    persist(latest.current);
  }, [persist]);

  const scheduleWrite = useCallback(
    (next: Plan[]) => {
      latest.current = next;
      if (timer.current !== undefined) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = undefined;
        persist(latest.current);
      }, PERSIST_DEBOUNCE_MS);
    },
    [persist],
  );

  /**
   * Applies a structural change at once: the pending edit burst is written
   * first (so it is not clobbered), then the new library is saved and any timer
   * is cancelled. These actions are rare and discrete, and the ones a user would
   * most hate to lose.
   */
  const persistNow = useCallback(
    (next: Plan[]) => {
      flush();
      latest.current = next;
      persist(next);
    },
    [flush, persist],
  );

  // A pending write must not be lost to a refresh, a closed tab or a navigation.
  // `pagehide` fires on mobile Safari where `beforeunload` does not.
  useEffect(() => {
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      // Also flush on unmount so a route change cannot drop the last keystrokes.
      flush();
    };
  }, [flush]);

  useEffect(() => {
    const storage = browserStorage();
    const envelope = readEnvelope(storage);
    if (envelope.plans.length > 0) {
      setPlans(envelope.plans);
      latest.current = envelope.plans;
      setActiveIdState(envelope.activeId);
    } else if (initial) {
      // First visit from a share link: seed the library with the shared plan.
      replaceAll(storage, [initial]);
      setPlans([initial]);
      latest.current = [initial];
      setActiveIdState(initial.id);
    }
    setReady(true);
    // `initial` seeds the library once, at mount. Re-seeding when the prop
    // identity changes would clobber the user's own plans.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const notify = useCallback((next: LibraryNotice) => setNotice(next), []);

  const setActive = useCallback((id: string) => {
    setActiveIdState(id);
    setActiveId(browserStorage(), id);
  }, []);

  const add = useCallback(
    (plan: Plan) => {
      const next = [plan, ...latest.current.filter((candidate) => candidate.id !== plan.id)];
      persistNow(next);
      setPlans(next);
      setActiveIdState(plan.id);
    },
    [persistNow],
  );

  const put = useCallback(
    (plan: Plan) => {
      const next = latest.current.map((candidate) =>
        candidate.id === plan.id ? plan : candidate,
      );
      persistNow(next);
      setPlans(next);
    },
    [persistNow],
  );

  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === activeId) ?? plans[0] ?? null,
    [plans, activeId],
  );

  const updateActive = useCallback(
    (mutate: (plan: Plan) => Plan) => {
      setPlans((current) => {
        const target = current.find((plan) => plan.id === activeId) ?? current[0];
        if (!target) return current;
        const next = { ...mutate(target), updatedAt: Date.now() };
        const updated = current.map((plan) => (plan.id === next.id ? next : plan));
        scheduleWrite(updated);
        return updated;
      });
    },
    [activeId, scheduleWrite],
  );

  const duplicate = useCallback(
    (id: string) => {
      const source = latest.current.find((plan) => plan.id === id);
      if (!source) return;
      const copy = duplicatePlan(source);
      const next = [copy, ...latest.current];
      persistNow(next);
      setPlans(next);
      setActiveIdState(copy.id);
      setNotice({ message: 'Duplicated. The copy is now open.', tone: 'success' });
    },
    [persistNow],
  );

  const remove = useCallback(
    (id: string) => {
      const removed = latest.current.find((plan) => plan.id === id);
      if (!removed) return;

      const remaining = latest.current.filter((plan) => plan.id !== id);
      const nextActiveId = activeIdRef.current === id ? (remaining[0]?.id ?? null) : activeIdRef.current;
      persistNow(remaining);
      setPlans(remaining);
      setActiveIdState(nextActiveId);
      activeIdRef.current = nextActiveId;
      if (nextActiveId) setActiveId(browserStorage(), nextActiveId);
      setNotice({
        message: `Deleted “${removed.name}”.`,
        tone: 'danger',
        undo: () => {
          const restored = [removed, ...latest.current.filter((plan) => plan.id !== removed.id)];
          persistNow(restored);
          setPlans(restored);
          setActiveIdState(removed.id);
          activeIdRef.current = removed.id;
          setActiveId(browserStorage(), removed.id);
          setNotice({ message: `Restored “${removed.name}”.`, tone: 'success' });
        },
      });
    },
    [persistNow],
  );

  const importFile = useCallback(
    async (file: File) => {
      const text = await file.text();
      const result = fromImportJson(text);
      if (!result.ok) {
        setNotice({
          message:
            result.reason === 'invalid_json'
              ? 'That file is not valid JSON.'
              : 'That file is not a Fête plan.',
          tone: 'danger',
        });
        return;
      }
      const next = [result.plan];
      persistNow(next);
      setPlans(next);
      setActiveIdState(result.plan.id);
      activeIdRef.current = result.plan.id;
      setActiveId(browserStorage(), result.plan.id);
      setNotice({ message: `Imported “${result.plan.name}”.`, tone: 'success' });
    },
    [persistNow],
  );

  const exportPlan = useCallback((id: string) => {
    const plan = readEnvelope(browserStorage()).plans.find((candidate) => candidate.id === id);
    if (!plan) return;
    downloadText(`${slug(plan.name)}.fete.json`, toExportJson(plan), 'application/json');
    setNotice({ message: 'Exported. Keep the file — it is the only backup.', tone: 'info' });
  }, []);

  const summaries: PlanSummary[] = useMemo(
    () =>
      [...plans]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((plan) => ({
          id: plan.id,
          name: plan.name,
          createdAt: plan.createdAt,
          updatedAt: plan.updatedAt,
          eventType: plan.brief.eventType,
          date: plan.brief.date,
        })),
    [plans],
  );

  return {
    ready,
    plans,
    summaries,
    activeId,
    activePlan,
    notice,
    dismissNotice: () => setNotice(null),
    notify,
    setActive,
    add,
    put,
    updateActive,
    duplicate,
    remove,
    importFile,
    exportPlan,
  };
}

/** Filesystem-safe name derived from a plan title. */
function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'fete-plan'
  );
}
