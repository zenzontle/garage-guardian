import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/** JSON reply that intermediaries must not cache. */
export const noStoreJson = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Service-role client for a cron run. Bounds the whole SDK workload (`budgetMs`) as well as
 * individual network calls (`callMs`).
 */
export function cronClient(url: string, key: string, { callMs = 5_000, budgetMs = 48_000 } = {}) {
  const budget = AbortSignal.timeout(budgetMs);
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.any([
            budget,
            AbortSignal.timeout(callMs),
            ...(init?.signal ? [init.signal] : []),
          ]),
        }),
    },
  });
}
