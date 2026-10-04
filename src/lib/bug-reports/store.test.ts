// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LOCK_TTL, RECEIPT_TTL, reportStore } from './store';
import { config, report } from './fixtures.test-helper';
import { reconcileReceipt, submitReport } from './submission';
import { errorResponse, ReportError } from './server-config';

const provider = vi.hoisted(() => ({ counts: new Map<string, number>(), values: new Map<string, unknown>(), expires: new Map<string, number>(), calls: [] as { key: string; prefix: string; duration: string }[], mode: 'ok' }));
vi.mock('@upstash/redis', () => ({ Redis: class {
  expire(key: string) { if ((provider.expires.get(key) ?? Infinity) <= Date.now()) { provider.values.delete(key); provider.expires.delete(key); } }
  async get(key: string) { this.expire(key); return structuredClone(provider.values.get(key) ?? null); }
  async set(key: string, value: unknown, options: { nx?: boolean; ex: number }) { this.expire(key); if (options.nx && provider.values.has(key)) return null; provider.values.set(key, structuredClone(value)); provider.expires.set(key, Date.now() + options.ex * 1000); return 'OK'; }
  async eval(_script: string, [key]: string[], [token]: string[]) { this.expire(key); if (provider.values.get(key) !== token) return 0; provider.values.delete(key); provider.expires.delete(key); return 1; }
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

beforeEach(() => { provider.counts.clear(); provider.values.clear(); provider.expires.clear(); provider.calls = []; provider.mode = 'ok'; });
describe('shared rate limits', () => {
  it('reads successful receipts regardless of repository casing and refuses other repositories', async () => {
    const store = reportStore({ ...config, repository: 'ZenZontle/Garage-Guardian' });
    const receipt = { hash: 'hash', state: 'succeeded' as const, assets: [], createdAt: Date.now(), issueUrl: 'https://github.com/zenzontle/garage-guardian/issues/12' };
    await store.claim('user', 'uuid', receipt);
    expect(await store.get('user', 'uuid')).toEqual(receipt);
    await store.save('user', 'uuid', { ...receipt, issueUrl: 'https://github.com/other/repo/issues/12' });
    await expect(store.get('user', 'uuid')).rejects.toHaveProperty('code', 'INVALID_RECEIPT');
  });
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
  it('recovers a terminated uploader after the lease expires and reuses its saved attachment', async () => {
    let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now);
    const first = reportStore(config), second = reportStore(config), value = report();
    const receipt = { hash: 'hash', state: 'uploading' as const, assets: ['https://github.com/user-attachments/assets/first'], createdAt: now };
    const github = { upload: vi.fn(async () => 'https://github.com/user-attachments/assets/second'), create: vi.fn(async () => 'https://github.com/zenzontle/garage-guardian/issues/1'), reconcile: vi.fn(async () => null) };
    await first.lock('user', value.submissionId);
    await first.claim('user', value.submissionId, receipt);
    now += (LOCK_TTL - 1) * 1000;
    expect((await reconcileReceipt(second, github, 'user', value.submissionId, receipt, value.metadata.reporterId)).state).toBe('uploading');
    expect(github.create).not.toHaveBeenCalled();
    now += 2000;
    const recovered = await reconcileReceipt(second, github, 'user', value.submissionId, receipt, value.metadata.reporterId);
    expect(recovered).toEqual({ ...receipt, state: 'failed' });
    expect(provider.expires.values().next().value).toBe(receipt.createdAt + RECEIPT_TTL * 1000);
    const result = await submitReport(second, github, 'user', 'ip', { report: value, images: [new Uint8Array([1]), new Uint8Array([2])], hash: 'hash' });
    expect(result.status).toBe(201);
    expect(github.upload).toHaveBeenCalledExactlyOnceWith(new Uint8Array([2]), 1);
    expect(github.create).toHaveBeenCalledTimes(1);
    expect(github.reconcile).not.toHaveBeenCalled();
  });
  it('does not let an expired lease owner release a newer lease', async () => {
    let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now);
    const first = reportStore(config), second = reportStore(config);
    const oldLease = await first.lock('user', 'uuid'); expect(oldLease).toBeTypeOf('string');
    now += (LOCK_TTL + 1) * 1000;
    const newLease = await second.lock('user', 'uuid'); expect(newLease).toBeTypeOf('string');
    expect(newLease).not.toBe(oldLease);
    await first.unlock('user', 'uuid', oldLease!);
    expect(await first.lock('user', 'uuid')).toBeNull();
    await second.unlock('user', 'uuid', newLease!);
    expect(await first.lock('user', 'uuid')).toBeTypeOf('string');
  });
});
