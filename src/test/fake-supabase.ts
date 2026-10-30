import { vi } from 'vitest';
import type { AuthChangeEvent, Session, SupabaseClient, User } from '@supabase/supabase-js';
import type { InitializeScheduleDefaultsArgs } from '@/lib/maintenance/schedule-defaults';
import type { SaveScheduleWithDefaultsArgs } from '@/lib/garage/repository';
import { scheduleDefaultsRpc } from './schedule-defaults-rpc';
import {
  mergeConversions,
  receiptInputs,
  sameInputs,
  validConversion,
  type Conversion,
  type Currency,
} from '@/lib/currency/currency';

type Row = Record<string, unknown> & { id: string; user_id?: string };
type Result = { data: unknown; error: Error | null };
export const account = (id = '44444444-4444-4444-8444-444444444444'): User =>
  ({ id, email: `${id}@example.com`, identities: [{ id: 'identity' }] }) as User;

export function fakeSupabase() {
  const tables = new Map<string, Map<string, Row>>();
  const photos = new Map<string, Blob>();
  let user: User | null = null;
  let confirmation = false;
  let existingSignup = false;
  let sessionVersion = 1;
  const listeners = new Set<(event: AuthChangeEvent, session: Session | null) => void>();
  const session = () =>
    user
      ? ({
          user,
          access_token: `header.${btoa(JSON.stringify({ session_id: `${user.id}-${sessionVersion}` }))}.signature`,
          refresh_token: 'test-refresh',
        } as Session)
      : null;
  const emit = (next: User | null, event: AuthChangeEvent = next ? 'SIGNED_IN' : 'SIGNED_OUT') => {
    user = next;
    for (const listener of listeners) listener(event, session());
  };
  const getTable = (name: string) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name)!;
  };
  const execute = vi.fn(
    async (
      name: string,
      operation: string,
      filters: [string, unknown][],
      row?: Row,
      range?: [number, number],
    ): Promise<Result> => {
      const table = getTable(name);
      if (name === 'vehicle_makes' || name === 'vehicle_models') {
        if (operation !== 'select') return { data: null, error: new Error('Catalog write denied') };
        const entries = [...table.values()]
          .filter((entry) => filters.every(([key, value]) => entry[key] === value))
          .sort((a, b) => String(a.lookup_key).localeCompare(String(b.lookup_key)));
        return {
          data: entries.slice(range?.[0] ?? 0, range ? range[1] + 1 : undefined),
          error: null,
        };
      }
      if (!user) return { data: null, error: new Error('Not authenticated') };
      if (operation === 'upsert') {
        if (row?.user_id !== user.id)
          return { data: null, error: new Error('Owner policy denied write') };
        if (
          name !== 'cars' &&
          name !== 'garage_settings' &&
          !getTable('cars').has(row.car_id as string)
        )
          return { data: null, error: new Error('Missing parent car') };
        const id = name === 'garage_settings' ? row.user_id : row.id;
        const previous = table.get(id);
        if (name === 'cars' && previous) row.is_archived = previous.is_archived;
        if (name === 'visits' && previous) {
          const unchanged =
            previous.currency === row.currency &&
            previous.service_date === row.service_date &&
            previous.total_cost_cents === row.total_cost_cents;
          if (unchanged)
            row.conversions = mergeConversions(
              previous.conversions as never,
              row.conversions as never,
            );
        }
        table.set(id, structuredClone(row));
        return { data: null, error: null };
      }
      const matches = [...table.values()].filter(
        (entry) =>
          entry.user_id === user?.id && filters.every(([key, value]) => entry[key] === value),
      );
      if (operation === 'update') {
        for (const entry of matches) Object.assign(entry, structuredClone(row));
      }
      if (operation === 'delete') {
        for (const entry of matches) {
          table.delete(entry.id);
          if (name === 'cars')
            for (const childName of ['schedule_items', 'visits', 'fuel_entries']) {
              for (const child of getTable(childName).values())
                if (child.car_id === entry.id) getTable(childName).delete(child.id);
            }
        }
      }
      return { data: matches.map((entry) => structuredClone(entry)), error: null };
    },
  );
  const from = vi.fn((name: string) => {
    let operation = 'select';
    let row: Row | undefined;
    let range: [number, number] | undefined;
    const filters: [string, unknown][] = [];
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((key: string, value: unknown) => {
        filters.push([key, value]);
        return builder;
      }),
      is: vi.fn((key: string, value: unknown) => {
        filters.push([key, value]);
        return builder;
      }),
      order: vi.fn(() => builder),
      range: vi.fn((start: number, end: number) => {
        range = [start, end];
        return builder;
      }),
      upsert: vi.fn((value: Row) => {
        operation = 'upsert';
        row = value;
        return builder;
      }),
      update: vi.fn((value: Partial<Row>) => {
        operation = 'update';
        row = value as Row;
        return builder;
      }),
      delete: vi.fn(() => {
        operation = 'delete';
        return builder;
      }),
      maybeSingle: vi.fn(async () => {
        const result = await execute(name, operation, filters, row);
        return { ...result, data: (result.data as Row[] | null)?.[0] ?? null };
      }),
      then: (resolve: (result: Result) => unknown, reject: (cause: unknown) => unknown) =>
        execute(name, operation, filters, row, range).then(resolve, reject),
    };
    return builder;
  });
  const bucket = {
    upload: vi.fn(async (path: string, blob: Blob) => {
      if (!user || !path.startsWith(`${user.id}/`))
        return { error: new Error('Photo owner policy denied write') };
      photos.set(path, blob);
      return { error: null };
    }),
    download: vi.fn(async (path: string) => ({
      data: photos.get(path) ?? null,
      error: photos.has(path) ? null : new Error('Missing cloud photo'),
    })),
    remove: vi.fn(async (paths: string[]) => {
      paths.forEach((path) => photos.delete(path));
      return { error: null as Error | null };
    }),
    createSignedUrl: vi.fn(async (path: string) => ({
      data: { signedUrl: `https://photos.example/${path}` },
      error: null,
    })),
  };
  const auth = {
    lock: true,
    initialize: vi.fn(async () => ({ error: null })),
    _acquireLock: vi.fn(async <R>(_timeout: number, work: () => Promise<R>) => work()),
    getUser: vi.fn(async () => ({ data: { user }, error: null })),
    resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
    resend: vi.fn(async () => ({ data: {}, error: null })),
    updateUser: vi.fn(async (attributes: { email?: string; password?: string }) => {
      if (user && attributes.email) user = { ...user, new_email: attributes.email };
      if (user) emit(user, 'USER_UPDATED');
      return { data: { user }, error: null };
    }),
    getSession: vi.fn(async () => ({ data: { session: session() }, error: null })),
    onAuthStateChange: vi.fn(
      (listener: (event: AuthChangeEvent, session: Session | null) => void) => {
        listeners.add(listener);
        return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
      },
    ),
    signInWithPassword: vi.fn(async () => {
      const next = account();
      emit(next);
      return { data: { user: next, session: session() }, error: null };
    }),
    signUp: vi.fn(async () => {
      const next = existingSignup ? { ...account(), identities: [] } : account();
      if (!confirmation && !existingSignup) emit(next);
      return {
        data: { user: next, session: confirmation || existingSignup ? null : session() },
        error: null,
      };
    }),
    signOut: vi.fn<
      (options?: { scope: 'local' | 'global' | 'others' }) => Promise<{ error: Error | null }>
    >(async () => {
      emit(null);
      return { error: null as Error | null };
    }),
  };
  Object.assign(auth, {
    _useSession: async <R>(
      work: (result: Awaited<ReturnType<typeof auth.getSession>>) => Promise<R>,
    ) => work(await auth.getSession()),
    _signOut: (options: { scope: 'local' }) => auth.signOut(options),
    _updateUser: (attributes: { password: string }) => auth.updateUser(attributes),
  });
  const storage = { from: vi.fn(() => bucket) };
  const rpc = vi.fn(
    async (
      name: string,
      args:
        | { p_car: Row }
        | InitializeScheduleDefaultsArgs
        | SaveScheduleWithDefaultsArgs
        | {
            p_visit_id: string;
            p_currency: Currency;
            p_date: string;
            p_total: number;
            p_target: Currency;
            p_conversion: Conversion;
          },
    ) => {
      if (name === 'save_car' && 'p_car' in args) {
        return execute('cars', 'upsert', [], args.p_car);
      }
      if (name === 'save_visit_conversion' && 'p_visit_id' in args) {
        const row = getTable('visits').get(args.p_visit_id);
        const inputs = {
          currency: args.p_currency,
          date: args.p_date,
          totalCostCents: args.p_total,
        };
        const conversions = (row?.conversions ?? {}) as Partial<Record<Currency, Conversion>>;
        if (
          row?.user_id === user?.id &&
          sameInputs(
            receiptInputs({
              currency: row!.currency as Currency,
              date: row!.service_date as string,
              totalCostCents: row!.total_cost_cents as number,
            }),
            inputs,
          ) &&
          !conversions[args.p_target] &&
          validConversion(args.p_conversion, inputs)
        ) {
          row!.conversions = {
            ...conversions,
            [args.p_target]: structuredClone(args.p_conversion),
          };
        }
        return { data: null, error: null };
      }
      if (!('p_user_id' in args)) throw new Error(`Unexpected RPC: ${name}`);
      if (!user || args.p_user_id !== user.id) return { data: [], error: null };
      let initializeArgs: InitializeScheduleDefaultsArgs;
      if (name === 'save_schedule_with_defaults' && 'p_item' in args) {
        const { error } = await execute('schedule_items', 'upsert', [], args.p_item);
        if (error) return { data: [], error };
        initializeArgs = {
          p_user_id: args.p_user_id,
          p_schedule_id: args.p_item.id,
          p_car_id: args.p_item.car_id,
          p_interval_miles: args.p_item.interval_miles,
          p_interval_months: args.p_item.interval_months,
          p_today: args.p_today,
        };
      } else if (name === 'initialize_schedule_defaults' && 'p_schedule_id' in args) {
        initializeArgs = args;
      } else throw new Error(`Unexpected RPC: ${name}`);
      return {
        data: scheduleDefaultsRpc(
          Object.fromEntries([...tables].map(([name, rows]) => [name, [...rows.values()]])),
          initializeArgs,
        ),
        error: null as Error | null,
      };
    },
  );
  return {
    client: { from, rpc, storage, auth: { ...auth } } as unknown as SupabaseClient,
    rpc,
    auth,
    from,
    bucket,
    execute,
    tables,
    photos,
    emit,
    newSession: () => {
      ++sessionVersion;
    },
    requireConfirmation: () => {
      confirmation = true;
    },
    existingSignup: () => {
      existingSignup = true;
    },
  };
}
