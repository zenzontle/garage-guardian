import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './repository';

export type CatalogEntry = { id: string; lookup_key: string; display_name: string };
export const normalizeVehicleKey = (value: string) => value.trim().replace(/\s+/gu, ' ').toLowerCase();
const cache = new Map<string, Promise<CatalogEntry[]>>();

export function createVehicleCatalogReader(client: SupabaseClient, project: string) {
  function read(table: 'vehicle_makes' | 'vehicle_models', makeId?: string): Promise<CatalogEntry[]> {
    const cacheKey = JSON.stringify([project, table, makeId]);
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    const request = (async () => {
      const rows: CatalogEntry[] = [];
      // Advance by the actual response length, and stop only at an empty page.
      // This also handles projects configured with a response cap below 500.
      while (true) {
        let query = client.from(table).select('id, lookup_key, display_name').order('lookup_key');
        if (makeId) query = query.eq('make_id', makeId);
        const { data, error } = await query.range(rows.length, rows.length + 499);
        if (error) throw error;
        if (!Array.isArray(data) || data.some((entry) =>
          typeof entry.id !== 'string' || !entry.id ||
          typeof entry.lookup_key !== 'string' || !entry.lookup_key ||
          typeof entry.display_name !== 'string' || !entry.display_name.trim() || entry.display_name.length > 50,
        )) throw new Error('Vehicle catalog returned invalid data.');
        if (!data.length) return rows;
        rows.push(...data as CatalogEntry[]);
      }
    })();
    cache.set(cacheKey, request);
    // A failed or partially read list is never retained; the next attempt retries.
    void request.catch(() => { if (cache.get(cacheKey) === request) cache.delete(cacheKey); });
    return request;
  }
  return { makes: () => read('vehicle_makes'), models: (makeId: string) => read('vehicle_models', makeId) };
}

export type VehicleCatalogReader = ReturnType<typeof createVehicleCatalogReader>;
export const vehicleCatalog = supabase
  ? createVehicleCatalogReader(supabase, process.env.NEXT_PUBLIC_SUPABASE_URL!)
  : null;

export function rankVehicleSuggestions(entries: CatalogEntry[], query: string): CatalogEntry[] {
  const lookup = normalizeVehicleKey(query);
  const rank = (entry: CatalogEntry) => entry.lookup_key === lookup ? 0 : entry.lookup_key.startsWith(lookup) ? 1 : 2;
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.lookup_key) || !entry.lookup_key.includes(lookup)) return false;
    seen.add(entry.lookup_key);
    return true;
  }).sort((a, b) => rank(a) - rank(b) || a.display_name.localeCompare(b.display_name, 'en', { sensitivity: 'base' }) || a.lookup_key.localeCompare(b.lookup_key, 'en')).slice(0, 10);
}
