import en from '../../messages/en.json';
import { recordDiagnostic } from './bug-reports/diagnostics';

export type ErrorCode = keyof typeof en.errors;
export type AppFailure = { code: ErrorCode; values?: Record<string, string | number> };

// Diagnostic messages stay on the exception, never in rendered UI state.
export class AppError extends Error {
  constructor(public readonly code: ErrorCode, public readonly values?: AppFailure['values']) {
    super(en.errors[code].replace(/\{(\w+)\}/g, (placeholder, key: string) => String(values?.[key] ?? placeholder)));
    this.name = 'AppError';
  }
}

export function failureOf(cause: unknown, fallback: ErrorCode = 'generic'): AppFailure {
  recordDiagnostic(cause);
  if (cause instanceof AppError) return { code: cause.code, values: cause.values };
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
  switch (code) {
    case 'invalid_credentials': return { code: 'invalidCredentials' };
    case 'email_not_confirmed': return { code: 'emailNotConfirmed' };
    case 'user_already_exists': case 'email_exists': return { code: 'accountExists' };
    case 'weak_password': return { code: 'weakPassword' };
    case 'over_request_rate_limit': case 'over_email_send_rate_limit': return { code: 'rateLimited' };
    case 'session_not_found': case 'refresh_token_not_found': case 'refresh_token_already_used': return { code: 'sessionExpired' };
  }
  return { code: fallback };
}
