import { vi } from 'vitest';
import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js';

type Row = Record<string, unknown> & { id: string; user_id?: string };
type Result = { data: unknown; error: Error | null };
export const account = (id = '44444444-4444-4444-8444-444444444444'): User => ({ id, email: `${id}@example.com`, identities: [{ id: 'identity' }] }) as User;

export function fakeSupabase() {
  const tables = new Map<string, Map<string, Row>>();
  const photos = new Map<string, Blob>();
  let user: User | null = null;
  let confirmation = false;
  let existingSignup = false;
  const listeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();
  const session = () => user ? { user } as Session : null;
  const emit = (next: User | null, event: AuthChangeEvent = next ? 'SIGNED_IN' : 'SIGNED_OUT') => {
    user = next;
    for (const listener of listeners) listener(event, session());
  };
  const getTable = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  };
  const execute = vi.fn(async (name: string, operation: string, filters: [string, unknown][], row?: Row, range?: [number, number]): Promise<Result> => {
    const table = getTable(name);
    if (name === 'vehicle_makes' || name === 'vehicle_models') {
      if (operation !== 'select') return { data: null, error: new Error('Catalog write denied') };
      const entries = [...table.values()].filter((entry) => filters.every(([key, value]) => entry[key] === value)).sort((a, b) => String(a.lookup_key).localeCompare(String(b.lookup_key)));
      return { data: entries.slice(range?.[0] ?? 0, range ? range[1] + 1 : undefined), error: null };
    }
    if (!user) return { data: null, error: new Error('Not authenticated') };
    if (operation === 'upsert') {
      if (row?.user_id !== user.id) return { data: null, error: new Error('Owner policy denied write') };
      if (name !== 'cars' && !getTable('cars').has(row.car_id as string)) return { data: null, error: new Error('Missing parent car') };
      table.set(row.id, structuredClone(row));
      return { data: null, error: null };
    }
    const matches = [...table.values()].filter((entry) => entry.user_id === user?.id && filters.every(([key, value]) => entry[key] === value));
    if (operation === 'delete') {
      for (const entry of matches) {
        table.delete(entry.id);
        if (name === 'cars') for (const childName of ['schedule_items', 'visits']) {
          for (const child of getTable(childName).values()) if (child.car_id === entry.id) getTable(childName).delete(child.id);
        }
      }
    }
    return { data: matches.map((entry) => structuredClone(entry)), error: null };
  });
  const from = vi.fn((name: string) => {
    let operation = 'select';
    let row: Row | undefined;
    let range: [number, number] | undefined;
    const filters: [string, unknown][] = [];
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((key: string, value: unknown) => { filters.push([key, value]); return builder; }),
      order: vi.fn(() => builder),
      range: vi.fn((start: number, end: number) => { range = [start, end]; return builder; }),
      upsert: vi.fn((value: Row) => { operation = 'upsert'; row = value; return builder; }),
      delete: vi.fn(() => { operation = 'delete'; return builder; }),
      maybeSingle: vi.fn(async () => {
        const result = await execute(name, operation, filters, row);
        return { ...result, data: (result.data as Row[] | null)?.[0] ?? null };
      }),
      then: (resolve: (result: Result) => unknown, reject: (cause: unknown) => unknown) => execute(name, operation, filters, row, range).then(resolve, reject),
    };
    return builder;
  });
  const bucket = {
    upload: vi.fn(async (path: string, blob: Blob) => {
      if (!user || !path.startsWith(`${user.id}/`)) return { error: new Error('Photo owner policy denied write') };
      photos.set(path, blob);
      return { error: null };
    }),
    download: vi.fn(async (path: string) => ({ data: photos.get(path) ?? null, error: photos.has(path) ? null : new Error('Missing cloud photo') })),
    remove: vi.fn(async (paths: string[]) => { paths.forEach((path) => photos.delete(path)); return { error: null }; }),
    createSignedUrl: vi.fn(async (path: string) => ({ data: { signedUrl: `https://photos.example/${path}` }, error: null })),
  };
  const auth = {
    getSession: vi.fn(async () => ({ data: { session: session() }, error: null })),
    onAuthStateChange: vi.fn((listener: (event: AuthChangeEvent, session: Session | null) => void) => {
      listeners.add(listener);
      return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
    }),
    signInWithPassword: vi.fn(async () => { const next = account(); emit(next); return { data: { user: next, session: session() }, error: null }; }),
    signUp: vi.fn(async () => {
      const next = existingSignup ? { ...account(), identities: [] } : account();
      if (!confirmation && !existingSignup) emit(next);
      return { data: { user: next, session: confirmation || existingSignup ? null : session() }, error: null };
    }),
    signOut: vi.fn(async () => { emit(null); return { error: null }; }),
  };
  const storage = { from: vi.fn(() => bucket) };
  return {
    client: { from, storage, auth } as unknown as SupabaseClient,
    auth, from, bucket, execute, tables, photos, emit,
    requireConfirmation: () => { confirmation = true; },
    existingSignup: () => { existingSignup = true; },
  };
}
