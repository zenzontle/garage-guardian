// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const provider = vi.hoisted(() => ({
  counts: new Map<string, number>(),
  calls: [] as { prefix: string; key: string }[],
  mode: 'ok' as 'ok' | 'timeout' | 'error',
  instances: 0,
}));
vi.mock('@upstash/redis', () => ({ Redis: class {} }));
vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    static slidingWindow(count: number, duration: string) {
      return { count, duration };
    }
    constructor(private options: { limiter: { count: number }; prefix: string }) {
      provider.instances++;
    }
    async limit(key: string) {
      if (provider.mode === 'error') throw new Error('redis down');
      if (provider.mode === 'timeout')
        return { success: true, reason: 'timeout', reset: 0, pending: Promise.resolve() };
      const id = `${this.options.prefix}:${key}`;
      const count = (provider.counts.get(id) ?? 0) + 1;
      provider.counts.set(id, count);
      provider.calls.push({ prefix: this.options.prefix, key });
      return {
        success: count <= this.options.limiter.count,
        reset: Date.now() + 90_000,
        pending: Promise.resolve(),
      };
    }
  },
}));

const request = (ip?: string) =>
  new Request('https://garage.example/api/account', {
    method: 'PATCH',
    headers: ip ? { 'x-vercel-forwarded-for': ip } : {},
  });
async function load() {
  vi.resetModules();
  return (await import('./account-rate-limit')).checkAccountLimit;
}
function deployed() {
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.test');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-token');
}

beforeEach(() => {
  provider.counts.clear();
  provider.calls = [];
  provider.mode = 'ok';
  provider.instances = 0;
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('account rate limits', () => {
  it('limits each user to five attempts per window and reports when to retry', async () => {
    deployed();
    const check = await load();
    for (let attempt = 0; attempt < 5; attempt++)
      expect(await check(request('192.0.2.1'), 'user-1')).toEqual({ status: 'allowed' });
    expect(await check(request('192.0.2.1'), 'user-1')).toEqual({
      status: 'limited',
      retryAfter: 90,
    });
    // Another account on the same network keeps its own allowance.
    expect(await check(request('192.0.2.1'), 'user-2')).toEqual({ status: 'allowed' });
  });

  it('limits one address across many accounts', async () => {
    deployed();
    const check = await load();
    for (let user = 0; user < 20; user++)
      expect((await check(request('192.0.2.1'), `user-${user}`)).status).toBe('allowed');
    expect((await check(request('192.0.2.1'), 'user-20')).status).toBe('limited');
    expect((await check(request('192.0.2.2'), 'user-20')).status).toBe('allowed');
  });

  it('stores hashed keys, separated by deployment environment', async () => {
    deployed();
    await (
      await load()
    )(request('192.0.2.1'), 'private-user');
    expect(provider.calls.map(({ prefix }) => prefix)).toEqual([
      'garage-guardian:account:production:user-short',
      'garage-guardian:account:production:user-daily',
      'garage-guardian:account:production:ip-short',
      'garage-guardian:account:production:ip-daily',
    ]);
    for (const { key } of provider.calls) {
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(key).not.toContain('private-user');
    }
  });

  it('reuses limiters across requests in a warm instance', async () => {
    deployed();
    const check = await load();
    await check(request('192.0.2.1'), 'user-1');
    await check(request('192.0.2.1'), 'user-1');
    expect(provider.instances).toBe(4);
  });

  it.each(['timeout', 'error'] as const)('fails closed on a limiter %s', async (mode) => {
    deployed();
    provider.mode = mode;
    expect(await (await load())(request('192.0.2.1'), 'user-1')).toEqual({
      status: 'unavailable',
    });
  });

  it('fails closed on a deployment without Redis or a trusted address', async () => {
    vi.stubEnv('VERCEL', '1');
    expect((await (await load())(request('192.0.2.1'), 'user-1')).status).toBe('unavailable');
    deployed();
    expect((await (await load())(request(), 'user-1')).status).toBe('unavailable');
    expect(provider.calls).toEqual([]);
  });

  it('refuses client-selected addresses on a production server outside Vercel', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.test');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'redis-token');
    expect((await (await load())(request('192.0.2.1'), 'user-1')).status).toBe('unavailable');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    expect((await (await load())(request('192.0.2.1'), 'user-1')).status).toBe('unavailable');
  });

  it('allows local development without Redis', async () => {
    expect(await (await load())(request(), 'user-1')).toEqual({ status: 'allowed' });
  });
});
