// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticate, clientIp, identifier, publicMetadata, reportConfig, reportingEnabled } from './server-config';
import { config } from './fixtures.test-helper';

const getUser = vi.hoisted(() => vi.fn());
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser } }) }));
beforeEach(() => { getUser.mockReset(); });
describe('configuration and verified identity', () => {
  it('defaults to disabled and rejects enabled but incomplete configuration', () => {
    vi.stubEnv('BUG_REPORTS_ENABLED', ''); expect(reportingEnabled()).toBe(false);
    vi.stubEnv('BUG_REPORTS_ENABLED', 'true'); expect(reportingEnabled()).toBe(true);
    vi.stubEnv('BUG_REPORT_HMAC_SECRET', ''); expect(reportConfig).toThrow('unavailable');
  });
  it('requires a server-verified nonanonymous Supabase account', async () => {
    const request = new Request('https://app.test', { headers: { authorization: 'Bearer actual-token' } });
    await expect(authenticate(new Request('https://app.test'), config)).rejects.toHaveProperty('status', 401);
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } });
    await expect(authenticate(request, config)).rejects.toHaveProperty('status', 401);
    getUser.mockResolvedValue({ data: { user: { id: 'forged', is_anonymous: true } }, error: null });
    await expect(authenticate(request, config)).rejects.toHaveProperty('status', 401);
    getUser.mockResolvedValue({ data: { user: { id: 'verified' } }, error: null });
    await expect(authenticate(request, config)).resolves.toBe('verified'); expect(getUser).toHaveBeenLastCalledWith('actual-token');
    getUser.mockRejectedValue(new Error('offline'));
    await expect(authenticate(request, config)).rejects.toHaveProperty('status', 503);
  });
  it('uses stable pseudonyms without exposing account IDs', () => {
    const metadata = publicMetadata(new Request('https://app.test', { headers: { 'user-agent': 'Browser on OS' } }), config, 'private-user');
    expect(metadata.reporterId).toMatch(/^reporter-[a-f0-9]{24}$/); expect(JSON.stringify(metadata)).not.toContain('private-user');
    expect(metadata.reporterId).toBe(publicMetadata(new Request('https://app.test'), config, 'private-user').reporterId);
    expect(identifier(config, 'ip', 'same')).not.toBe(identifier(config, 'user', 'same'));
  });
  it('normalizes trusted IPs and refuses spoofable headers', () => {
    vi.stubEnv('VERCEL', '1');
    expect(clientIp(new Request('https://app.test', { headers: { 'x-vercel-forwarded-for': '::ffff:192.0.2.1' } }))).toBe('192.0.2.1');
    expect(clientIp(new Request('https://app.test', { headers: { 'x-vercel-forwarded-for': '2001:0db8:0000::1' } }))).toBe('2001:db8::1');
    expect(() => clientIp(new Request('https://app.test', { headers: { 'x-forwarded-for': 'spoofed' } }))).toThrow();
    expect(() => clientIp(new Request('https://app.test', { headers: { 'x-vercel-forwarded-for': '192.0.2.1, 192.0.2.2' } }))).toThrow();
  });
});
