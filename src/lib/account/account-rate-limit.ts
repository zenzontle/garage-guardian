import { createHash } from 'node:crypto';
import { Ratelimit, type Duration } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { vercelClientIp } from '../utils/client-ip';

// Each attempt verifies the current password against Supabase from this server, where
// Supabase's per-IP sign-in limit sees Vercel's shared addresses, not the caller's.
const RULES: { name: string; tokens: number; window: Duration; scope: 'user' | 'ip' }[] = [
  { name: 'user-short', tokens: 5, window: '10 m', scope: 'user' },
  { name: 'user-daily', tokens: 20, window: '1 d', scope: 'user' },
  { name: 'ip-short', tokens: 20, window: '10 m', scope: 'ip' },
  { name: 'ip-daily', tokens: 100, window: '1 d', scope: 'ip' },
];

export type AccountLimit =
  { status: 'allowed' } | { status: 'limited'; retryAfter: number } | { status: 'unavailable' };

// Module scope: warm instances reuse the limiters, and their ephemeral cache answers
// already-blocked callers without spending Redis commands from the Free quota.
let cached: { signature: string; limiters: Ratelimit[] } | undefined;
function limiters() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const environment = process.env.VERCEL_ENV || 'development';
  const signature = JSON.stringify([url, token, environment]);
  if (cached?.signature !== signature) {
    const redis = new Redis({ url, token, retry: false });
    cached = {
      signature,
      limiters: RULES.map(
        (rule) =>
          new Ratelimit({
            redis,
            limiter: Ratelimit.slidingWindow(rule.tokens, rule.window),
            prefix: `garage-guardian:account:${environment}:${rule.name}`,
            analytics: false,
            timeout: 3000,
          }),
      ),
    };
  }
  return cached.limiters;
}

// Keys never hold raw user IDs or addresses.
const keyOf = (scope: string, value: string) =>
  createHash('sha256').update(`${scope}:${value}`).digest('hex');

export async function checkAccountLimit(request: Request, userId: string): Promise<AccountLimit> {
  const onVercel = Boolean(process.env.VERCEL);
  const local = !onVercel && process.env.NODE_ENV !== 'production';
  const active = limiters();
  // Local development may run without Redis; deployments must not skip the limit.
  if (!active) return local ? { status: 'allowed' } : { status: 'unavailable' };
  // Outside Vercel, forwarding headers are client-selected and cannot identify a caller.
  const ip = onVercel ? vercelClientIp(request) : local ? '127.0.0.1' : null;
  if (!ip) return { status: 'unavailable' };
  const keys = { user: keyOf('user', userId), ip: keyOf('ip', ip) };
  try {
    const results = await Promise.all(
      active.map(async (limiter, index) => {
        const result = await limiter.limit(keys[RULES[index].scope]);
        // The SDK reports a timeout as success; never let it through.
        if (result.reason === 'timeout') throw new Error('limiter_timeout');
        await result.pending;
        return result;
      }),
    );
    const denied = results.filter((result) => !result.success);
    if (!denied.length) return { status: 'allowed' };
    const reset = Math.max(...denied.map((result) => result.reset));
    return { status: 'limited', retryAfter: Math.max(1, Math.ceil((reset - Date.now()) / 1000)) };
  } catch {
    return { status: 'unavailable' };
  }
}
