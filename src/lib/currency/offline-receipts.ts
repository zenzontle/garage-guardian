'use client';

import { get, update } from 'idb-keyval';
import { normalizeSnapshot, type Snapshot, type Visit } from '../garage/model';
import { mergeConversions, receiptInputs, sameInputs, type Currency } from './currency';

type PendingReceipt = { visit: Visit; manualTargets: Currency[] };
type CachedGarage = { snapshot: Snapshot; pending: PendingReceipt[] };
const operations = new Map<string, Promise<unknown>>();
export function connectionFailure(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : '';
  return /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(
    message,
  );
}
export class OfflineReceipts {
  private key: string;
  constructor(project: string, userId: string) {
    this.key = `garage-guardian:account-receipts:v1:${project}:${userId}`;
  }
  async read() {
    return get<CachedGarage>(this.key);
  }
  async withLock<T>(action: () => Promise<T>): Promise<T> {
    const previous = operations.get(this.key);
    const work = (async () => {
      await previous?.catch(() => {});
      if (typeof navigator !== 'undefined' && navigator.locks)
        return navigator.locks.request(this.key, action);
      return action();
    })();
    operations.set(this.key, work);
    try {
      return await work;
    } finally {
      if (operations.get(this.key) === work) operations.delete(this.key);
    }
  }
  async rememberVisit(visit: Visit) {
    await update<CachedGarage | undefined>(this.key, (current) => {
      if (!current) return current;
      const previous = current.snapshot.visits.find((entry) => entry.id === visit.id);
      const unchanged = previous && sameInputs(receiptInputs(previous), receiptInputs(visit));
      const merged = {
        ...visit,
        conversions: unchanged
          ? mergeConversions(previous.conversions, visit.conversions)
          : visit.conversions,
      };
      return {
        ...current,
        snapshot: {
          ...current.snapshot,
          visits: [...current.snapshot.visits.filter((entry) => entry.id !== visit.id), merged],
        },
      };
    });
  }
  async remember(snapshot: Snapshot): Promise<Snapshot> {
    let merged = snapshot;
    await update<CachedGarage>(this.key, (saved) => {
      const pending = saved?.pending ?? [];
      const ids = new Set(pending.map(({ visit }) => visit.id));
      merged = {
        ...snapshot,
        visits: [
          ...snapshot.visits.filter((visit) => !ids.has(visit.id)),
          ...pending.map(({ visit }) => visit),
        ],
        pendingSyncCount: pending.length,
      };
      if (!pending.length) delete merged.pendingSyncCount;
      return { snapshot: merged, pending };
    });
    return merged;
  }
  async enqueue(visit: Visit, manualTargets: Currency[]) {
    await update<CachedGarage>(this.key, (saved) => {
      if (!saved) throw new Error('No cached account garage');
      const previous = saved.snapshot.visits.find((entry) => entry.id === visit.id);
      const pending = saved.pending.find((entry) => entry.visit.id === visit.id);
      const unchanged = previous && sameInputs(receiptInputs(previous), receiptInputs(visit));
      const merged = {
        ...visit,
        conversions: unchanged
          ? mergeConversions(previous.conversions, visit.conversions)
          : visit.conversions,
      };
      const targets = unchanged
        ? [...new Set([...(pending?.manualTargets ?? []), ...manualTargets])]
        : manualTargets;
      const receipts = [
        ...saved.pending.filter((entry) => entry.visit.id !== visit.id),
        { visit: merged, manualTargets: targets },
      ];
      return {
        snapshot: {
          ...saved.snapshot,
          pendingSyncCount: receipts.length,
          visits: [...saved.snapshot.visits.filter((entry) => entry.id !== visit.id), merged],
        },
        pending: receipts,
      };
    });
  }
  async cachedSnapshot() {
    const saved = await this.read();
    return saved ? normalizeSnapshot(saved.snapshot) : null;
  }
  async acknowledge(receipt: PendingReceipt) {
    await update<CachedGarage>(this.key, (current) => {
      if (!current) throw new Error('No cached account garage');
      const pending = current.pending.filter(
        (entry) => JSON.stringify(entry) !== JSON.stringify(receipt),
      );
      return {
        ...current,
        pending,
        snapshot: { ...current.snapshot, pendingSyncCount: pending.length },
      };
    });
  }
  async remove(visitId?: string, carId?: string) {
    await update<CachedGarage | undefined>(this.key, (current) => {
      if (!current) return current;
      const keep = (visit: Visit) => visit.id !== visitId && visit.carId !== carId;
      const pending = current.pending.filter(({ visit }) => keep(visit));
      return {
        snapshot: {
          ...current.snapshot,
          visits: current.snapshot.visits.filter(keep),
          pendingSyncCount: pending.length,
        },
        pending,
      };
    });
  }
  async flush(save: (receipt: PendingReceipt) => Promise<void>) {
    const pending = (await this.read())?.pending ?? [];
    for (const receipt of pending) {
      await save(receipt);
      await this.acknowledge(receipt);
    }
  }
}
