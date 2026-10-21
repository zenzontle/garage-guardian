'use client';

import { useEffect, useRef, useState } from 'react';
import type { Repository } from '../garage/repository';
import type { Visit } from '../garage/model';
import { automaticConversion, receiptInputs, reportingCents, type Currency } from './currency';
import { lookupRate } from './rate-client';

export function useBackgroundConversions(
  repository: Repository | null,
  visits: Visit[],
  target: Currency,
  refresh: () => Promise<void>,
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
    const queue = visits.filter((visit) => reportingCents(visit, target) === null);
    if (!queue.length) {
      setBusy(false);
      return;
    }
    setBusy(true);
    const worker = async () => {
      while (active && queue.length) {
        const visit = queue.shift()!;
        const inputs = receiptInputs(visit);
        const key = JSON.stringify([visit.id, inputs, target]);
        if (seen.has(key)) continue;
        try {
          const rate = await lookupRate(inputs.currency, target, inputs.date);
          if (!active) break;
          await repository.saveConversion(visit, target, automaticConversion(inputs, rate));
          seen.add(key);
          saved = true;
        } catch {
          if (active) seen.add(key);
          /* Missing conversions remain visible and can be retried or entered manually. */
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
  }, [repository, visits, target, refresh, revision]);
  return {
    busy,
    retry: () => {
      if (repository) attempted.current.delete(repository);
      setRevision((value) => value + 1);
    },
  };
}
