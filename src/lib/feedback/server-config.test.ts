// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authenticate,
  clientIp,
  identifier,
  publicMetadata,
  reportConfig,
  reportingEnabled,
} from './server-config';
import { config } from './fixtures.test-helper';

const getUser = vi.hoisted(() => vi.fn());
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser } }) }));
beforeEach(() => {
  getUser.mockReset();
});
describe('configuration and verified identity', () => {
  it('defaults to disabled and rejects enabled but incomplete configuration', () => {
    vi.stubEnv('FEEDBACK_ENABLED', '');
    expect(reportingEnabled()).toBe(false);
    vi.stubEnv('FEEDBACK_ENABLED', 'true');
    expect(reportingEnabled()).toBe(true);
    vi.stubEnv('FEEDBACK_HMAC_SECRET', '');
    expect(reportConfig).toThrow('unavailable');
  });
  it('requires a Linear API key and team UUID and keeps Redis keys per team', () => {
    const team = '6F1C3F5E-1B2A-4C3D-8E9F-0A1B2C3D4E5F';
    for (const [key, value] of Object.entries({
      FEEDBACK_HMAC_SECRET: 'x'.repeat(32),
      FEEDBACK_LINEAR_API_KEY: 'lin_api_test',
      FEEDBACK_LINEAR_TEAM_ID: team,
      FEEDBACK_ENVIRONMENT: 'preview',
      FEEDBACK_RELEASE: '0.1.0+test',
      UPSTASH_REDIS_REST_URL: 'https://test.upstash.io',
      UPSTASH_REDIS_REST_TOKEN: 'redis-test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
    }))
      vi.stubEnv(key, value);
    expect(reportConfig()).toMatchObject({
      linearApiKey: 'lin_api_test',
      linearTeamId: team.toLowerCase(),
      prefix: `garage-guardian:feedback:linear:${team.toLowerCase()}:preview`,
    });
    for (const [key, value] of [
      ['FEEDBACK_LINEAR_API_KEY', ''],
      ['FEEDBACK_LINEAR_API_KEY', 'lin_api_test\nInjected: header'],
      ['FEEDBACK_LINEAR_TEAM_ID', ''],
      ['FEEDBACK_LINEAR_TEAM_ID', 'FB'],
      ['FEEDBACK_LINEAR_TEAM_ID', `${team}:other`],
    ]) {
      vi.stubEnv('FEEDBACK_LINEAR_API_KEY', 'lin_api_test');
      vi.stubEnv('FEEDBACK_LINEAR_TEAM_ID', team);
      vi.stubEnv(key, value);
      expect(reportConfig).toThrow(expect.objectContaining({ code: 'NOT_CONFIGURED' }));
    }
  });
  it('requires a server-verified nonanonymous Supabase account', async () => {
    const request = new Request('https://app.test', {
      headers: { authorization: 'Bearer actual-token' },
    });
    await expect(authenticate(new Request('https://app.test'), config)).rejects.toHaveProperty(
      'status',
      401,
    );
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } });
    await expect(authenticate(request, config)).rejects.toHaveProperty('status', 401);
    getUser.mockResolvedValue({
      data: { user: { id: 'forged', is_anonymous: true } },
      error: null,
    });
    await expect(authenticate(request, config)).rejects.toHaveProperty('status', 401);
    getUser.mockResolvedValue({ data: { user: { id: 'verified' } }, error: null });
    await expect(authenticate(request, config)).resolves.toBe('verified');
    expect(getUser).toHaveBeenLastCalledWith('actual-token');
    getUser.mockRejectedValue(new Error('offline'));
    await expect(authenticate(request, config)).rejects.toHaveProperty('status', 503);
  });
  it('uses stable pseudonyms without exposing account IDs', () => {
    const metadata = publicMetadata(
      new Request('https://app.test', { headers: { 'user-agent': 'Browser on OS' } }),
      config,
      'private-user',
    );
    expect(metadata.reporterId).toMatch(/^reporter-[a-f0-9]{24}$/);
    expect(JSON.stringify(metadata)).not.toContain('private-user');
    expect(metadata.reporterId).toBe(
      publicMetadata(new Request('https://app.test'), config, 'private-user').reporterId,
    );
    expect(identifier(config, 'ip', 'same')).not.toBe(identifier(config, 'user', 'same'));
  });
  it('normalizes trusted IPs and refuses spoofable headers', () => {
    vi.stubEnv('VERCEL', '1');
    expect(
      clientIp(
        new Request('https://app.test', {
          headers: { 'x-vercel-forwarded-for': '::ffff:192.0.2.1' },
        }),
      ),
    ).toBe('192.0.2.1');
    expect(
      clientIp(
        new Request('https://app.test', {
          headers: { 'x-vercel-forwarded-for': '2001:0db8:0000::1' },
        }),
      ),
    ).toBe('2001:db8::1');
    expect(() =>
      clientIp(new Request('https://app.test', { headers: { 'x-forwarded-for': 'spoofed' } })),
    ).toThrow();
    expect(() =>
      clientIp(
        new Request('https://app.test', {
          headers: { 'x-vercel-forwarded-for': '192.0.2.1, 192.0.2.2' },
        }),
      ),
    ).toThrow();
  });
});
