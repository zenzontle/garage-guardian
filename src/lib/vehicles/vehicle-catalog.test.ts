import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  createVehicleCatalogReader,
  normalizeVehicleKey,
  rankVehicleSuggestions,
  type CatalogEntry,
} from './vehicle-catalog';

const entry = (name: string): CatalogEntry => ({
  id: name,
  display_name: name,
  lookup_key: normalizeVehicleKey(name),
});
function pagedClient(rows: CatalogEntry[], cap: number) {
  const pages: [number, number][] = [],
    filters: [string, string][] = [];
  const range = vi.fn(async (start: number, end: number) => {
    pages.push([start, end]);
    return { data: rows.slice(start, Math.min(end + 1, start + cap)), error: null };
  });
  const query = {
    select: () => query,
    order: () => query,
    eq: (column: string, value: string) => {
      filters.push([column, value]);
      return query;
    },
    range,
  };
  const from = vi.fn(() => query);
  return { client: { from } as unknown as SupabaseClient, from, range, pages, filters };
}

describe('catalog reads and local ranking', () => {
  it('normalizes lookup keys and ranks exact, prefix, then substring alphabetically with deduplication and a limit of ten', () => {
    expect(normalizeVehicleKey('  LaND   Rover ')).toBe('land rover');
    const ranked = rankVehicleSuggestions(
      ['Z Toy', 'Toyota', 'Toy', 'TOY', 'A Toy', 'Toyland'].map(entry),
      'toY',
    );
    expect(ranked.map((row) => row.display_name)).toEqual([
      'Toy',
      'Toyland',
      'Toyota',
      'A Toy',
      'Z Toy',
    ]);
    expect(
      rankVehicleSuggestions(['Z', 'A', 'B'].map(entry), '').map((row) => row.display_name),
    ).toEqual(['A', 'B', 'Z']);
    expect(
      rankVehicleSuggestions(
        Array.from({ length: 15 }, (_, i) => entry(`Car ${i}`)),
        '',
      ),
    ).toHaveLength(10);
    expect(rankVehicleSuggestions([entry('CR-V')], 'crv')).toEqual([]);
  });
  it('reads every page even with a smaller server cap, shares inflight/successful lists, and isolates projects and makes', async () => {
    const fake = pagedClient(['A', 'B', 'C', 'D', 'E'].map(entry), 2);
    const reader = createVehicleCatalogReader(fake.client, 'pagination');
    const first = reader.makes();
    expect(reader.makes()).toBe(first);
    expect(await first).toHaveLength(5);
    expect(fake.pages).toEqual([
      [0, 499],
      [2, 501],
      [4, 503],
      [5, 504],
    ]);
    await createVehicleCatalogReader(fake.client, 'pagination').makes();
    expect(fake.range).toHaveBeenCalledTimes(4);
    await reader.models('toyota');
    await reader.models('honda');
    expect(fake.filters.some(([column, value]) => column === 'make_id' && value === 'toyota')).toBe(
      true,
    );
    expect(fake.filters.some(([, value]) => value === 'honda')).toBe(true);
    await createVehicleCatalogReader(fake.client, 'another-project').makes();
    expect(fake.range).toHaveBeenCalledTimes(16);
  });
  it('evicts failed and partial reads so they can be retried', async () => {
    const fake = pagedClient(['A', 'B', 'C'].map(entry), 2);
    fake.range
      .mockResolvedValueOnce({ data: [entry('A')], error: null })
      .mockRejectedValueOnce(new Error('offline'));
    const reader = createVehicleCatalogReader(fake.client, 'retry');
    await expect(reader.makes()).rejects.toThrow('offline');
    expect(await reader.makes()).toHaveLength(3);
  });
  it('rejects malformed responses before they can break the editable inputs', async () => {
    const fake = pagedClient([], 500);
    fake.range.mockResolvedValueOnce({ data: [{ id: 'bad' } as CatalogEntry], error: null });
    const reader = createVehicleCatalogReader(fake.client, 'malformed');
    await expect(reader.makes()).rejects.toThrow('invalid data');
    expect(await reader.makes()).toEqual([]);
  });
});
