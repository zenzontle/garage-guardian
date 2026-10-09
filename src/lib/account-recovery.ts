import type { Session } from '@supabase/supabase-js';

const key = () => `garage-guardian:recovery:${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''}`;
// Store only identity and session ID, never callback credentials or tokens.
function binding(session: Session) {
  try {
    const claims = JSON.parse(
      atob(session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    ) as { session_id?: string };
    return claims.session_id ? `${session.user.id}:${claims.session_id}` : null;
  } catch {
    return null;
  }
}
export function sameRecoverySession(first: Session, second: Session) {
  const id = binding(first);
  return id !== null && id === binding(second);
}
export function rememberRecovery(session: Session, finishing = false) {
  const id = binding(session);
  try {
    if (id) {
      // Match Auth's persistence so closing a tab cannot lift recovery restrictions.
      localStorage.setItem(key(), JSON.stringify({ id, finishing }));
      sessionStorage.removeItem(key());
    }
  } catch {
    /* Recovery remains usable without reload persistence. */
  }
}
export function storedRecovery(session: Session): { finishing: boolean } | null {
  try {
    const persisted = localStorage.getItem(key());
    const stored = JSON.parse(persisted ?? sessionStorage.getItem(key()) ?? 'null') as {
      id: string;
      finishing: boolean;
    } | null;
    const id = binding(session);
    if (!id || stored?.id !== id) return null;
    // Migrate an existing tab's marker when upgrading from tab-only storage.
    if (!persisted) rememberRecovery(session, Boolean(stored.finishing));
    return { finishing: Boolean(stored.finishing) };
  } catch {
    return null;
  }
}
export function clearRecovery() {
  try {
    localStorage.removeItem(key());
    sessionStorage.removeItem(key());
  } catch {
    /* Storage is optional. */
  }
}
export function clearAuthCallback() {
  const url = new URL(window.location.href);
  const names = [
    'code',
    'error',
    'error_code',
    'error_description',
    'access_token',
    'refresh_token',
    'token_hash',
    'type',
    'expires_in',
    'expires_at',
    'token_type',
  ];
  for (const name of names) url.searchParams.delete(name);
  const hash = new URLSearchParams(url.hash.slice(1));
  if (names.some((name) => hash.has(name))) url.hash = '';
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}
