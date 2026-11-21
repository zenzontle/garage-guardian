'use client';

import { useEffect, useRef, useState } from 'react';
import type { Repository } from '../garage/repository';
import type { Expense, FuelEntry, Visit } from '../garage/model';
import {
  automaticConversion,
  receiptInputs,
  reportingCents,
  type Conversion,
  type Currency,
} from './currency';
import { lookupRate } from './rate-client';

type Pending =
  | { kind: 'visit'; record: Visit }
  | { kind: 'fuel'; record: FuelEntry }
  | { kind: 'expense'; record: Expense };

// Stable defaults, so omitted lists never restart the effect.
const NO_FUEL: FuelEntry[] = [];
const NO_EXPENSES: Expense[] = [];

function save(repository: Repository, item: Pending, target: Currency, conversion: Conversion) {
  if (item.kind === 'visit') return repository.saveConversion(item.record, target, conversion);
  if (item.kind === 'fuel') return repository.saveFuelConversion(item.record, target, conversion);
  return repository.saveExpenseConversion(item.record, target, conversion);
}

export function useBackgroundConversions(
  repository: Repository | null,
  visits: Visit[],
  target: Currency,
  refresh: () => Promise<void>,
  fuelEntries: FuelEntry[] = NO_FUEL,
  expenses: Expense[] = NO_EXPENSES,
) {
  const attempted = useRef(new WeakMap<Repository, Set<string>>());
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!repository) return;
    let active = true;
    let saved = false;
    const seen = attempted.current.get(repository) ?? new Set<string>();
    attempted.current.set(repository, seen);
    const queue: Pending[] = [
      ...visits.map((record) => ({ kind: 'visit' as const, record })),
      ...fuelEntries.map((record) => ({ kind: 'fuel' as const, record })),
      ...expenses.map((record) => ({ kind: 'expense' as const, record })),
    ].filter((item) => reportingCents(item.record, target) === null);
    if (!queue.length) {
      setBusy(false);
      return;
    }
    setBusy(true);
    const worker = async () => {
      while (active && queue.length) {
        const item = queue.shift()!;
        const inputs = receiptInputs(item.record);
        const key = JSON.stringify([item.kind, item.record.id, inputs, target]);
        if (seen.has(key)) continue;
        try {
          const rate = await lookupRate(inputs.currency, target, inputs.date);
          if (!active) break;
          await save(repository, item, target, automaticConversion(inputs, rate));
          seen.add(key);
          saved = true;
        } catch {
          if (active) seen.add(key);
          /* Missing conversions remain visible and are retried on the next load; visits can also be
             converted by hand. */
        }
      }
    };
    void Promise.all([worker(), worker(), worker()]).then(async () => {
      if (active) setBusy(false);
      // A new effect may already be showing an older snapshot. Reconcile every committed write.
      if (saved) await refresh();
    });
    return () => {
      active = false;
    };
  }, [repository, visits, fuelEntries, expenses, target, refresh, revision]);
  return {
    busy,
    retry: () => {
      if (repository) attempted.current.delete(repository);
      setRevision((value) => value + 1);
    },
  };
}
