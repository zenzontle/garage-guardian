import { expect, it } from 'vitest';
import { AppError, failureOf } from './app-error';
import { recentDiagnostics, startDiagnostics } from './bug-reports/diagnostics';

it('keeps app error codes and interpolation values independent of presentation', () => {
  expect(failureOf(new AppError('photoMissing', { name: 'receipt.webp' }))).toEqual({ code: 'photoMissing', values: { name: 'receipt.webp' } });
  expect(failureOf(new AppError('plateLength', { count: 20 })).code).toBe('plateLength');
});
it.each([
  ['invalid_credentials', 'invalidCredentials'], ['email_not_confirmed', 'emailNotConfirmed'],
  ['weak_password', 'weakPassword'], ['user_already_exists', 'accountExists'],
  ['over_email_send_rate_limit', 'rateLimited'], ['refresh_token_not_found', 'sessionExpired'],
])('maps recognized provider code %s to %s', (code, expected) => {
  expect(failureOf({ code, message: 'Provider diagnostic' })).toEqual({ code: expected });
});
it('does not render unknown provider details or secrets', () => {
  expect(failureOf(new Error('Bearer secret'), 'save')).toEqual({ code: 'save' });
  expect(failureOf({ code: 'unknown', message: 'secret' })).toEqual({ code: 'generic' });
});
it('records caught errors for reports while keeping localized UI failures free of diagnostics', () => {
  const stop = startDiagnostics();
  try {
    expect(failureOf(new Error('Save failed Bearer private-token owner@example.org'), 'save')).toEqual({ code: 'save' });
    expect(recentDiagnostics()).toHaveLength(1);
    expect(recentDiagnostics()[0]).toMatchObject({ source: 'operation', message: 'Save failed Bearer [REDACTED] [EMAIL]' });
  } finally { stop(); }
});
