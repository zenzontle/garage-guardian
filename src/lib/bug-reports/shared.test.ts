import { describe, expect, it, vi } from 'vitest';
import { cleanDiagnostic, formatIssue, issueTitle, redact, reportSchema } from './shared';
import { clearDiagnostics, recentDiagnostics, recordDiagnostic, startDiagnostics } from './diagnostics';
import { report } from './fixtures.test-helper';

describe('public report diagnostics', () => {
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
