'use client';

import { useEffect, useState } from 'react';
import { normalizeVehicleKey, vehicleCatalog, type CatalogEntry, type VehicleCatalogReader } from './vehicle-catalog';

type ListState = { entries: CatalogEntry[]; loading: boolean; failed: boolean };
const empty: ListState = { entries: [], loading: false, failed: false };

export function useVehicleCatalog(enabled: boolean, make: string, reader: VehicleCatalogReader | null = vehicleCatalog) {
  const [makes, setMakes] = useState<ListState>(empty);
  const [models, setModels] = useState<ListState & { makeId: string | null }>({ ...empty, makeId: null });
  const [attempt, setAttempt] = useState(0);
  const makeId = enabled ? makes.entries.find((entry) => entry.lookup_key === normalizeVehicleKey(make))?.id ?? null : null;

  useEffect(() => {
    if (!enabled || !reader) return;
    let active = true;
    setMakes({ ...empty, loading: true });
    void reader.makes().then(
      (entries) => { if (active) setMakes({ entries, loading: false, failed: false }); },
      () => { if (active) setMakes({ ...empty, failed: true }); },
    );
    return () => { active = false; };
  }, [enabled, reader, attempt]);

  useEffect(() => {
    if (!enabled || !reader || !makeId) return;
    let active = true;
    setModels({ ...empty, makeId, loading: true });
    void reader.models(makeId).then(
      (entries) => { if (active) setModels({ entries, makeId, loading: false, failed: false }); },
      () => { if (active) setModels({ ...empty, makeId, failed: true }); },
    );
    return () => { active = false; };
  }, [enabled, reader, makeId, attempt]);

  return {
    makes: enabled ? makes : empty,
    models: enabled && makeId && models.makeId === makeId ? models : empty,
    retry: () => setAttempt((value) => value + 1),
  };
}
