import { describe, expect, it, vi } from 'vitest';
import { REPORT_LIMITS, cleanDiagnostic, fitsIssueBody, formatIssue, isRepositoryIssueUrl, issueTitle, redact, reportSchema } from './shared';
import { clearDiagnostics, recentDiagnostics, recordDiagnostic, startDiagnostics } from './diagnostics';
import { oversizedReport, report } from './fixtures.test-helper';

describe('public report diagnostics', () => {
  it.each([
    'password="correct horse battery staple"',
    "secret='correct horse battery staple'",
    '{"access_token":"first second third"}',
    'api_key="first \\"quoted\\" second"',
    "passwd='first \\'quoted\\' second'",
    'password="first second third',
    'password="first second third\\',
    'secret="first\nsecond\nthird"',
    'Authorization: Basic dXNlcjpwYXNz',
    'authorization=Bearer first second third',
    'Authorization: Digest username="first", response="second third"',
    'authorization="Negotiate first second third"',
    'Cookie="session=first; other=second third"',
  ])('redacts complete quoted credentials and authorization values: %s', (source) => {
    const sanitized = redact(source);
    expect(sanitized).toContain('[REDACTED]');
    for (const secret of ['correct', 'horse', 'battery', 'staple', 'first', 'second', 'third', 'quoted', 'dXNlcjpwYXNz']) expect(sanitized).not.toContain(secret);
    expect(redact(sanitized)).toBe(sanitized);
    const entry = { source: 'operation' as const, timestamp: Date.now(), message: source, stack: source };
    expect(cleanDiagnostic(cleanDiagnostic(entry))).toEqual(cleanDiagnostic(entry));
  });
  it('redacts IPv4 addresses after arbitrary labels while preserving known browser versions', () => {
    const source = 'remote/203.0.113.5 client/192.168.1.20 custom-label/10.0.0.1 203.0.113.6 Chrome/154.0.0.0 Firefox/128.0.0.0 Edg/129.0.0.0 Safari/537.36';
    const sanitized = redact(source);
    expect(sanitized).toBe('remote/[IP] client/[IP] custom-label/[IP] [IP] Chrome/154.0.0.0 Firefox/128.0.0.0 Edg/129.0.0.0 Safari/537.36');
    expect(redact(sanitized)).toBe(sanitized);
    expect(redact('remote/999.0.0.1')).toBe('remote/999.0.0.1');
  });
  it('bounds the complete body including maximum attachment markup at the character boundary', () => {
    const draft = oversizedReport(), assets = Array(2).fill('x'.repeat(REPORT_LIMITS.assetUrl));
    expect(reportSchema.safeParse(draft).success).toBe(true);
    expect(formatIssue(draft).length).toBeGreaterThan(REPORT_LIMITS.issueBody);
    expect(fitsIssueBody(draft)).toBe(false);
    const excess = formatIssue(draft, assets).length - REPORT_LIMITS.issueBody;
    draft.description = draft.description.slice(0, draft.description.length - excess);
    expect(reportSchema.safeParse(draft).success).toBe(true);
    expect(formatIssue(draft, assets).length).toBe(REPORT_LIMITS.issueBody);
    expect(fitsIssueBody(draft)).toBe(true);
    draft.description += 'x';
    expect(fitsIssueBody(draft)).toBe(false);
  });
  it('counts long Markdown fences and Unicode in the formatted body bound', () => {
    const draft = oversizedReport();
    draft.description = '`'.repeat(5000);
    draft.diagnostics[0].message = '😀'.repeat(500);
    draft.diagnostics[0].stack = '`'.repeat(2000);
    expect(fitsIssueBody(draft)).toBe(false);
    draft.diagnostics = [];
    expect(fitsIssueBody(draft)).toBe(true);
    expect(formatIssue(draft).length).toBeLessThan(REPORT_LIMITS.issueBody);
  });
  it('compares issue repository names without casing while enforcing the URL boundary', () => {
    expect(isRepositoryIssueUrl('https://github.com/ZenZontle/Garage-Guardian/issues/12', 'zenzontle/garage-guardian')).toBe(true);
    for (const url of ['https://evil.test/zenzontle/garage-guardian/issues/12', 'https://github.com/zenzontle/other/issues/12', 'https://github.com/zenzontle/garage-guardian/issues/12/extra', 'https://github.com/zenzontle/garage-guardian/issues/12?token=x', 'https://token@github.com/zenzontle/garage-guardian/issues/12', 'not a URL']) {
      expect(isRepositoryIssueUrl(url, 'zenzontle/garage-guardian')).toBe(false);
    }
  });
  it('strips URL credentials/queries/fragments and redacts recognizable secrets and identifiers', () => {
    const result = redact('https://user:pass@example.com/cars?token=secret#email /cars?query-private#fragment-private 192.168.1.20 token=abc password:hello test@example.org Bearer eyJabc.abcdef.signature 1HGCM82633A004352 github_pat_12345 {"access_token":"private-session"} b3a37ad0-6f5a-4ca8-96e1-499b169767df');
    expect(result).toContain('https://example.com/cars');
    for (const privateValue of ['user:pass', 'secret#', 'query-private', 'fragment-private', '192.168.1.20', 'token=abc', 'hello', 'test@example.org', 'eyJabc', '1HGCM82633A004352', 'github_pat_12345', 'private-session', 'b3a37ad0-6f5a-4ca8-96e1-499b169767df']) expect(result).not.toContain(privateValue);
    expect(redact(result)).toBe(result);
    expect(redact('Chrome/154.0.0.0 Safari/537.36')).toBe('Chrome/154.0.0.0 Safari/537.36');
    const entry = cleanDiagnostic({ message: 'x'.repeat(2000), stack: 'x'.repeat(4000), source: 'operation', timestamp: 1 });
    expect(entry.message.length).toBe(1000); expect(entry.stack.length).toBe(2000);
  });
  it('bounds capture, expires errors, restores console, and never accesses logged objects', () => {
    const original = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Date, 'now').mockReturnValue(1000000);
    const stop = startDiagnostics();
    const getter = vi.fn(() => { throw new Error('should never run'); });
    console.error(Object.defineProperty({}, 'message', { get: getter }));
    for (let index = 0; index < 25; index++) recordDiagnostic(`Error ${index}`);
    expect(recentDiagnostics()).toHaveLength(20);
    expect(getter).not.toHaveBeenCalled(); expect(original).toHaveBeenCalledTimes(1);
    vi.spyOn(Date, 'now').mockReturnValue(1300001);
    expect(recentDiagnostics()).toEqual([]);
    stop(); expect(console.error).toBe(original);
    recordDiagnostic('disabled'); expect(recentDiagnostics()).toEqual([]);
    clearDiagnostics();
  });
  it('captures browser errors and rejections without suppressing them', () => {
    const stop = startDiagnostics();
    window.dispatchEvent(new ErrorEvent('error', { message: 'broken', error: new Error('broken') }));
    const event = new Event('unhandledrejection', { cancelable: true });
    Object.assign(event, { reason: 'rejected' });
    window.dispatchEvent(event);
    expect(recentDiagnostics().map((entry) => entry.source)).toEqual(['browser', 'rejection']);
    expect(event.defaultPrevented).toBe(false); stop();
  });
  it('keeps the Error message and stack when console.error also has a text prefix', () => {
    const original = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stop = startDiagnostics();
    const cause = new Error('Save failed');
    console.error('Operation failed:', cause, { private: 'never serialize' });
    expect(recentDiagnostics()[0]).toMatchObject({ source: 'console', message: 'Operation failed: Save failed', stack: cause.stack });
    expect(original).toHaveBeenCalledWith('Operation failed:', cause, { private: 'never serialize' });
    stop();
  });
  it('does not break console for unreadable errors or keep recording through another console wrapper after cleanup', () => {
    const original = console.error;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const stop = startDiagnostics();
    const unreadable = Object.defineProperty(new Error(), 'message', { get() { throw new Error('unreadable'); } });
    expect(() => console.error(unreadable)).not.toThrow();
    expect(() => recordDiagnostic(unreadable)).not.toThrow();
    const owned = console.error;
    console.error = (...args) => owned(...args);
    stop(); console.error('old wrapper after sign-out');
    expect(recentDiagnostics()).toEqual([]);
    const stopNext = startDiagnostics();
    console.error('next account error');
    expect(recentDiagnostics()).toHaveLength(1);
    stopNext(); console.error = original;
  });
  it('keeps Markdown injection inside literal fences and rejects unknown/control fields', () => {
    const draft = report(); draft.description = '```\n<img src="https://evil.test">\n![x](https://evil.test) @someone\n```';
    const issue = formatIssue(draft);
    expect(issue).toContain('````text\n```'); expect(issueTitle('@someone bug')).not.toContain('@someone');
    expect(reportSchema.safeParse({ ...report(), userId: 'spoofed' }).success).toBe(false);
    expect(reportSchema.safeParse({ ...report(), description: 'invalid\u0000description' }).success).toBe(false);
    expect(reportSchema.safeParse({ ...report(), acknowledged: false }).success).toBe(false);
  });
});
