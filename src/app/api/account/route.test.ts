// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { account } from '@/test/fake-supabase';
import { PATCH } from './route';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
const owner = account();
const identity = { auth: { getUser: vi.fn() } };
const verification = {
  auth: { signInWithPassword: vi.fn(), updateUser: vi.fn(), signOut: vi.fn() },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'public-key');
  identity.auth.getUser.mockResolvedValue({ data: { user: owner }, error: null });
  verification.auth.signInWithPassword.mockResolvedValue({
    data: { user: owner, session: { access_token: 'verification-token' } },
    error: null,
  });
  verification.auth.updateUser.mockResolvedValue({ data: { user: owner }, error: null });
  verification.auth.signOut.mockResolvedValue({ error: null });
  vi.mocked(createClient).mockImplementation(
    () =>
      ({ auth: { ...identity.auth, ...verification.auth } }) as unknown as ReturnType<
        typeof createClient
      >,
  );
});
function request(method: string, body: unknown, token = 'caller-token') {
  return new Request('https://garage.example/api/account', {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: JSON.stringify(body),
  });
}
const password = { kind: 'password', currentPassword: 'current-secret', newPassword: 'new-secret' };
const email = { kind: 'email', currentPassword: 'current-secret', newEmail: 'next@example.com' };
async function expectError(result: Response, code: string, status?: number) {
  expect(await result.json()).toEqual({ error: { code } });
  if (status) expect(result.status).toBe(status);
  expect(result.headers.get('cache-control')).toBe('no-store');
}

it('requires a bearer token and rejects an expired identity before password verification', async () => {
  await expectError(await PATCH(request('PATCH', password, '')), 'sessionExpired', 401);
  identity.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { code: 'bad_jwt' } });
  await expectError(await PATCH(request('PATCH', password)), 'sessionExpired', 401);
  expect(verification.auth.signInWithPassword).not.toHaveBeenCalled();
});
describe.each([
  { name: 'email', input: email },
  { name: 'password', input: password },
])('$name authorization', ({ input }) => {
  const invoke = (body: unknown) => PATCH(request('PATCH', body));
  it('rejects incorrect current passwords without any account mutation', async () => {
    verification.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { code: 'invalid_credentials' },
    });
    await expectError(await invoke(input), 'currentPasswordIncorrect', 403);
    expect(verification.auth.updateUser).not.toHaveBeenCalled();
  });
  it('rejects mismatched reauthenticated identities and ends their temporary session', async () => {
    verification.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: account('different-user'), session: {} },
      error: null,
    });
    await expectError(await invoke(input), 'sessionExpired', 403);
    expect(verification.auth.updateUser).not.toHaveBeenCalled();
    expect(verification.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('rejects browser-supplied target IDs', async () => {
    await expectError(await invoke({ ...input, userId: 'victim' }), 'accountInput', 400);
    expect(verification.auth.signInWithPassword).not.toHaveBeenCalled();
  });
});
it('uses the verified email and an isolated nonpersistent client for secure email change', async () => {
  const result = await PATCH(request('PATCH', email));
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ status: 'confirmationRequired' });
  expect(identity.auth.getUser).toHaveBeenCalledWith('caller-token');
  expect(verification.auth.signInWithPassword).toHaveBeenCalledWith({
    email: owner.email,
    password: email.currentPassword,
  });
  expect(verification.auth.updateUser).toHaveBeenCalledWith({ email: email.newEmail });
  expect(verification.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  for (const call of vi.mocked(createClient).mock.calls)
    expect(call[2]?.auth).toEqual({
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    });
});
it('revokes refresh sessions after updating the password and cleans up on provider failure', async () => {
  expect((await PATCH(request('PATCH', password))).status).toBe(200);
  expect(verification.auth.signOut.mock.calls).toEqual([
    [{ scope: 'global' }],
    [{ scope: 'local' }],
  ]);
});
it('finishes revocation when a retry verifies the already-updated password', async () => {
  verification.auth.signOut.mockResolvedValueOnce({ error: new Error('Revocation offline') });
  await expectError(await PATCH(request('PATCH', password)), 'sessionRevocation', 502);
  verification.auth.updateUser.mockResolvedValueOnce({ error: { code: 'same_password' } });
  const result = await PATCH(
    request('PATCH', { ...password, currentPassword: password.newPassword }),
  );
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ status: 'passwordChanged' });
  expect(verification.auth.signInWithPassword).toHaveBeenLastCalledWith({
    email: owner.email,
    password: password.newPassword,
  });
  expect(verification.auth.signOut.mock.calls).toEqual([
    [{ scope: 'global' }],
    [{ scope: 'local' }],
    [{ scope: 'global' }],
    [{ scope: 'local' }],
  ]);
});
it('does not bypass update errors unless the verified password is the requested password', async () => {
  verification.auth.updateUser.mockResolvedValue({ error: { code: 'same_password' } });
  await expectError(await PATCH(request('PATCH', password)), 'samePassword');
  await expectError(await PATCH(request('PATCH', email)), 'samePassword');
  expect(verification.auth.signOut.mock.calls).toEqual([
    [{ scope: 'local' }],
    [{ scope: 'local' }],
  ]);
});
it.each(['weak_password', 'over_request_rate_limit', 'over_email_send_rate_limit'])(
  'translates %s and closes the verification session',
  async (code) => {
    verification.auth.updateUser.mockResolvedValueOnce({ error: { code } });
    await expectError(
      await PATCH(request('PATCH', password)),
      code === 'weak_password' ? 'weakPassword' : 'rateLimited',
    );
    expect(verification.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  },
);
it('rejects malformed, oversized, and weak requests', async () => {
  await expectError(
    await PATCH(request('PATCH', { ...password, newPassword: 'short' })),
    'accountInput',
  );
  await expectError(
    await PATCH(request('PATCH', { ...password, currentPassword: 'x'.repeat(9000) })),
    'accountInput',
  );
});
it('reports temporary-session cleanup failure and password revocation failure without false success', async () => {
  verification.auth.signOut.mockResolvedValueOnce({ error: new Error('Offline') });
  await expectError(await PATCH(request('PATCH', email)), 'accountSessionCleanup', 502);
  verification.auth.signOut.mockResolvedValueOnce({ error: new Error('Offline') });
  await expectError(await PATCH(request('PATCH', password)), 'sessionRevocation', 502);
});
