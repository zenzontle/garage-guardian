import { vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { InitializeScheduleDefaultsArgs } from '@/lib/maintenance/schedule-defaults';
import { scheduleDefaultsRpc } from '@/test/schedule-defaults-rpc';

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code: string } | null; count?: number };
type RpcArgs = { p_user_id: string } | InitializeScheduleDefaultsArgs;
export function reminderStore() {
  const tables: Record<string, Row[]> = {
    notification_preferences: [],
    reminder_deliveries: [],
    cars: [],
    schedule_items: [],
    visits: [],
  };
  const calls: { table: string; operation: string; filters: [string, string, unknown][] }[] = [];
  let failOutcome = false;
  let failClaims = false;
  const from = vi.fn((table: string) => {
    let operation = 'select';
    let values: Row = {};
    const filters: [string, string, unknown][] = [];
    const ordering: string[] = [];
    let single = false;
    let head = false;
    let limit = Infinity;
    let offset = 0;
    let after = '';
    const builder = {
      select: (_columns?: string, options?: { head?: boolean }) => {
        head = Boolean(options?.head);
        return builder;
      },
      eq: (key: string, value: unknown) => {
        filters.push(['eq', key, value]);
        return builder;
      },
      is: (key: string, value: unknown) => {
        filters.push(['eq', key, value]);
        return builder;
      },
      lt: (key: string, value: unknown) => {
        filters.push(['lt', key, value]);
        return builder;
      },
      lte: (key: string, value: unknown) => {
        filters.push(['lte', key, value]);
        return builder;
      },
      order: (key: string) => {
        ordering.push(key);
        return builder;
      },
      limit: (count: number) => {
        limit = count;
        return builder;
      },
      range: (start: number, end: number) => {
        offset = start;
        limit = end - start + 1;
        return builder;
      },
      or: (value: string) => {
        after = value;
        return builder;
      },
      update: (value: Row) => {
        operation = 'update';
        values = value;
        return builder;
      },
      insert: (value: Row) => {
        operation = 'insert';
        values = value;
        return builder;
      },
      delete: () => {
        operation = 'delete';
        return builder;
      },
      maybeSingle: () => {
        single = true;
        return builder;
      },
      single: () => {
        single = true;
        return builder;
      },
      then: (resolve: (result: Result) => unknown) => {
        calls.push({ table, operation, filters });
        if (
          failOutcome &&
          table === 'reminder_deliveries' &&
          operation === 'update' &&
          filters.some(([, key]) => key === 'week_start')
        )
          return Promise.resolve(resolve({ data: null, error: { code: 'db_down' } }));
        let matches = tables[table].filter((row) =>
          filters.every(([op, key, value]) => {
            if (op === 'eq') return row[key] === value;
            if (row[key] == null) return false;
            return op === 'lt'
              ? String(row[key]) < String(value)
              : String(row[key]) <= String(value);
          }),
        );
        if (after) {
          const stamp = after.split('next_scheduled_at.gt.')[1].split(',')[0];
          const id = after.split('user_id.gt.')[1].slice(0, -1);
          matches = matches.filter(
            (row) =>
              String(row.next_scheduled_at) > stamp ||
              (row.next_scheduled_at === stamp && String(row.user_id) > id),
          );
        }
        matches.sort((a, b) => {
          for (const key of ordering) {
            const order = String(a[key]).localeCompare(String(b[key]));
            if (order) return order;
          }
          return 0;
        });
        const count = matches.length;
        matches = matches.slice(offset, offset + limit);
        if (operation === 'update') matches.forEach((row) => Object.assign(row, values));
        if (operation === 'delete')
          tables[table] = tables[table].filter((row) => !matches.includes(row));
        if (operation === 'insert') {
          if (tables[table].some((row) => row.user_id === values.user_id))
            return Promise.resolve(resolve({ data: null, error: { code: '23505' } }));
          const row = {
            enabled: false,
            weekday: 1,
            email_language: 'en',
            next_scheduled_at: null,
            ...values,
          };
          tables[table].push(row);
          matches = [row];
        }
        return Promise.resolve(
          resolve({
            data: head ? null : single ? (matches[0] ?? null) : matches.map((row) => ({ ...row })),
            error: null,
            count,
          }),
        );
      },
    };
    return builder;
  });
  const getUserById = vi.fn(async (id: string) => ({
    data: { user: { id, email: `${id}@example.com`, email_confirmed_at: '2026-01-01' } },
    error: null,
  }));
  const getUser = vi.fn(async () => ({ data: { user: { id: 'owner' } }, error: null }));
  const rpc = vi.fn(async (name: string, args: RpcArgs) => {
    if (name === 'initialize_schedule_defaults' && 'p_schedule_id' in args)
      return { data: scheduleDefaultsRpc(tables, args), error: null };
    if (failClaims) return { data: null, error: { code: 'db_down' } };
    const pref = tables.notification_preferences.find((row) => row.user_id === args.p_user_id);
    if (!pref?.enabled || String(pref.next_scheduled_at) > new Date().toISOString())
      return { data: null, error: null };
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const week = date.toISOString().slice(0, 10);
    pref.next_scheduled_at = new Date(Date.now() + 7 * 86400000).toISOString();
    if (
      tables.reminder_deliveries.some(
        (row) => row.user_id === args.p_user_id && row.week_start === week,
      )
    )
      return { data: null, error: null };
    tables.reminder_deliveries.push({
      user_id: args.p_user_id,
      week_start: week,
      status: 'processing',
      attempted_at: new Date().toISOString(),
    });
    return { data: week, error: null };
  });
  const db = { from, rpc, auth: { getUser, admin: { getUserById } } } as unknown as SupabaseClient;
  function addAccount(id: string, language = 'en') {
    tables.notification_preferences.push({
      user_id: id,
      enabled: true,
      weekday: 1,
      email_language: language,
      next_scheduled_at: '2026-10-05T16:00:00.000Z',
    });
    tables.cars.push({
      id: `${id}-car`,
      user_id: id,
      name: `${id} car`,
      year: 2020,
      make: 'Car',
      model: 'Model',
      odometer: 9500,
      distance_unit: 'miles',
      reminder_days: 30,
      reminder_miles: 500,
    });
    tables.schedule_items.push({
      id: `${id}-task`,
      user_id: id,
      car_id: `${id}-car`,
      name: `${id} oil`,
      interval_miles: 10000,
      interval_months: null,
      first_due_miles: 10000,
      first_due_date: null,
      is_active: true,
    });
  }
  return {
    db,
    tables,
    calls,
    addAccount,
    getUserById,
    getUser,
    rpc,
    failOutcome: () => {
      failOutcome = true;
    },
    failClaims: () => {
      failClaims = true;
    },
  };
}
