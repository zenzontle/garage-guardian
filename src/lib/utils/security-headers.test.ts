// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, securityHeaders } from './security-headers';

const directives = (policy: string) =>
  Object.fromEntries(
    policy.split('; ').map((directive) => {
      const [name, ...sources] = directive.split(' ');
      return [name, sources];
    }),
  );

describe('security headers', () => {
  it('limits production scripts and connections to the app and its Supabase project', () => {
    const policy = directives(
      contentSecurityPolicy({
        supabaseUrl: 'https://project.supabase.co/ignored/path',
        development: false,
      }),
    );
    expect(policy['script-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy['connect-src']).toEqual(["'self'", 'https://project.supabase.co']);
    expect(policy['img-src']).toEqual(["'self'", 'data:', 'blob:']);
    expect(policy['frame-ancestors']).toEqual(["'none'"]);
    expect(policy['object-src']).toEqual(["'none'"]);
    expect(policy['base-uri']).toEqual(["'self'"]);
    expect(policy['form-action']).toEqual(["'self'"]);
  });

  it('allows development tooling only in development', () => {
    const production = contentSecurityPolicy({ development: false });
    const development = directives(contentSecurityPolicy({ development: true }));
    expect(production).not.toMatch(/unsafe-eval|vercel-scripts|ws:/);
    expect(development['script-src']).toContain("'unsafe-eval'");
    expect(development['script-src']).toContain('https://va.vercel-scripts.com');
    expect(development['connect-src']).toContain('ws:');
  });

  it('works without a cloud project and rejects an insecure production one', () => {
    expect(directives(contentSecurityPolicy({ development: false }))['connect-src']).toEqual([
      "'self'",
    ]);
    expect(() =>
      contentSecurityPolicy({ supabaseUrl: 'http://project.test', development: false }),
    ).toThrow();
    expect(
      directives(
        contentSecurityPolicy({ supabaseUrl: 'http://127.0.0.1:54321', development: true }),
      )['connect-src'],
    ).toContain('http://127.0.0.1:54321');
  });

  it('sends framing, sniffing, referrer, opener, and transport protections', () => {
    const headers = Object.fromEntries(
      securityHeaders({ development: false }).map(({ key, value }) => [key, value]),
    );
    expect(headers).toMatchObject({
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Strict-Transport-Security': 'max-age=63072000',
    });
    expect(headers['Permissions-Policy']).toContain('camera=()');
  });
});
