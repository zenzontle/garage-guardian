// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reportStore } from './store';
import { config } from './fixtures.test-helper';
import { errorResponse, ReportError } from './server-config';

const provider = vi.hoisted(() => ({ counts: new Map<string, number>(), values: new Map<string, unknown>(), calls: [] as { key: string; prefix: string; duration: string }[], mode: 'ok' }));
vi.mock('@upstash/redis', () => ({ Redis: class {
  async get(key: string) { return provider.values.get(key) ?? null; }
  async set(key: string, value: unknown, options: { nx?: boolean }) { if (options.nx && provider.values.has(key)) return null; provider.values.set(key, structuredClone(value)); return 'OK'; }
  async del(key: string) { provider.values.delete(key); }
} }));
vi.mock('@upstash/ratelimit', () => ({ Ratelimit: class {
  static slidingWindow(count: number, duration: string) { return { count, duration }; }
  constructor(private options: { limiter: { count: number; duration: string }; prefix: string; analytics: boolean }) { expect(options.analytics).toBe(false); }
  async limit(key: string) {
    provider.calls.push({ key, prefix: this.options.prefix, duration: this.options.limiter.duration });
    if (provider.mode === 'throw') throw new Error('offline');
    if (provider.mode === 'timeout') return { success: true, reason: 'timeout', pending: new Promise(() => {}), reset: Date.now() + 1000 };
    const name = `${this.options.prefix}:${key}`, next = (provider.counts.get(name) ?? 0) + 1;
    provider.counts.set(name, next);
    return { success: next <= this.options.limiter.count, reset: Date.now() + 600_000, pending: Promise.resolve() };
  }
} }));

beforeEach(() => { provider.counts.clear(); provider.values.clear(); provider.calls = []; provider.mode = 'ok'; });
describe('shared rate limits', () => {
  it('enforces user limits across instances independently of IPs', async () => {
    for (let index = 0; index < 3; index++) await reportStore(config).limit('private-user', `private-ip-${index}`);
    await expect(reportStore(config).limit('private-user', 'new-ip')).rejects.toHaveProperty('status', 429);
    expect(provider.calls.every((call) => !call.key.includes('private'))).toBe(true);
    expect(new Set(provider.calls.map((call) => call.duration))).toEqual(new Set(['10 m', '1 d']));
  });
  it('enforces IP limits across distinct users and isolates deployments', async () => {
    for (let index = 0; index < 10; index++) await reportStore(config).limit(`user-${index}`, 'shared-ip');
    await expect(reportStore(config).limit('user-11', 'shared-ip')).rejects.toHaveProperty('status', 429);
    await expect(reportStore({ ...config, prefix: 'test:production' }).limit('user-11', 'shared-ip')).resolves.toBeUndefined();
  });
  it('enforces both daily limits even when the short windows allow the request', async () => {
    await reportStore(config).limit('daily-user', 'daily-ip');
    const userDaily = provider.calls.find((call) => call.prefix.endsWith(':user-daily'))!;
    provider.counts.set(`${userDaily.prefix}:${userDaily.key}`, 10);
    await expect(reportStore(config).limit('daily-user', 'another-ip')).rejects.toHaveProperty('status', 429);
    provider.counts.clear(); provider.calls = [];
    await reportStore(config).limit('new-user', 'daily-ip');
    const ipDaily = provider.calls.find((call) => call.prefix.endsWith(':ip-daily'))!;
    provider.counts.set(`${ipDaily.prefix}:${ipDaily.key}`, 50);
    await expect(reportStore(config).limit('another-user', 'daily-ip')).rejects.toHaveProperty('status', 429);
  });
  it('fails closed on SDK timeouts without waiting on an unresolved pending promise', async () => {
    provider.mode = 'timeout';
    await expect(reportStore(config).limit('user', 'ip')).rejects.toHaveProperty('code', 'LIMITER_UNAVAILABLE');
    provider.mode = 'throw';
    await expect(reportStore(config).limit('user', 'ip')).rejects.toThrow('offline');
    const response = errorResponse(new ReportError(429, 'RATE_LIMITED', 'Wait', 60));
    expect(response.headers.get('retry-after')).toBe('60');
    expect(errorResponse(new Error('private provider details')).status).toBe(503);
  });
  it('claims atomically and isolates receipts by verified user', async () => {
    const first = reportStore(config), second = reportStore(config);
    const receipt = { hash: 'hash', state: 'uploading' as const, assets: [], createdAt: Date.now() };
    expect(await Promise.all([first.claim('one', 'uuid', receipt), second.claim('one', 'uuid', receipt)])).toEqual([true, false]);
    expect(await first.get('two', 'uuid')).toBeNull();
  });
});
