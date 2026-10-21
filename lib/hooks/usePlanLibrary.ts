'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Plan, PlanSummary } from '@/lib/schemas/plan';
import {
  browserStorage,
  deletePlan,
  readEnvelope,
  replaceAll,
  setActiveId,
  upsertPlan,
  type StorageLike,
} from '@/lib/storage/plans';
import { duplicatePlan } from '@/lib/domain/plan';
import { fromImportJson, toExportJson } from '@/lib/share/encode';
import { downloadText } from '@/lib/client/browser';

export type NoticeTone = 'info' | 'success' | 'danger';

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
 * Every write goes straight through, which is why there is no save button — a
 * refresh, a crash or a closed tab can never lose work. Because a mutation
 * cannot be undone by the browser, deletion keeps the removed plan in state and
 * exposes it through the notice's `undo`, so a mis-click is always recoverable.
 */
export function usePlanLibrary(initial?: Plan): PlanLibraryApi {
  const [ready, setReady] = useState(false);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [notice, setNotice] = useState<LibraryNotice | null>(null);

  useEffect(() => {
    const storage = browserStorage();
    const envelope = readEnvelope(storage);
    if (envelope.plans.length > 0) {
      setPlans(envelope.plans);
      setActiveIdState(envelope.activeId);
    } else if (initial) {
      // First visit from a share link: seed the library with the shared plan.
      replaceAll(storage, [initial]);
      setPlans([initial]);
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

  const add = useCallback((plan: Plan) => {
    upsertPlan(browserStorage(), plan);
    setPlans((current) => [plan, ...current.filter((candidate) => candidate.id !== plan.id)]);
    setActiveIdState(plan.id);
  }, []);

  const put = useCallback((plan: Plan) => {
    upsertPlan(browserStorage(), plan);
    setPlans((current) =>
      current.map((candidate) => (candidate.id === plan.id ? plan : candidate)),
    );
  }, []);

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
        upsertPlan(browserStorage(), next);
        return current.map((plan) => (plan.id === next.id ? next : plan));
      });
    },
    [activeId],
  );

  const duplicate = useCallback((id: string) => {
    const storage = browserStorage();
    const source = readEnvelope(storage).plans.find((plan) => plan.id === id);
    if (!source) return;
    const copy = duplicatePlan(source);
    upsertPlan(storage, copy);
    setPlans((current) => [copy, ...current]);
    setActiveIdState(copy.id);
    setNotice({ message: 'Duplicated. The copy is now open.', tone: 'success' });
  }, []);

  const remove = useCallback((id: string) => {
    const storage: StorageLike | undefined = browserStorage();
    const removed = readEnvelope(storage).plans.find((plan) => plan.id === id);
    if (!removed) return;

    const envelope = deletePlan(storage, id);
    setPlans(envelope.plans);
    setActiveIdState(envelope.activeId);
    setNotice({
      message: `Deleted “${removed.name}”.`,
      tone: 'danger',
      undo: () => {
        upsertPlan(storage, removed);
        setPlans((current) => [removed, ...current.filter((plan) => plan.id !== removed.id)]);
        setActiveIdState(removed.id);
        setNotice({ message: `Restored “${removed.name}”.`, tone: 'success' });
      },
    });
  }, []);

  const importFile = useCallback(async (file: File) => {
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
    const storage = browserStorage();
    const envelope = replaceAll(storage, [result.plan]);
    setPlans(envelope.plans);
    setActiveIdState(result.plan.id);
    setNotice({ message: `Imported “${result.plan.name}”.`, tone: 'success' });
  }, []);

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
