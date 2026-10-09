// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fakeSupabase, account } from '@/test/fake-supabase';
import { DELETE, PATCH } from './route';
import { removeAccountPhotos } from '@/lib/account-server';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
const owner = account();
const identity = { auth: { getUser: vi.fn() } };
const verification = {
  auth: { signInWithPassword: vi.fn(), updateUser: vi.fn(), signOut: vi.fn() },
};
let photos: ReturnType<typeof fakeSupabase>;
const lock = vi.fn();
const deleteUser = vi.fn();
let admin: SupabaseClient;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'public-key');
  vi.stubEnv('SUPABASE_SECRET_KEY', 'server-secret');
  identity.auth.getUser.mockResolvedValue({ data: { user: owner }, error: null });
  verification.auth.signInWithPassword.mockResolvedValue({
    data: { user: owner, session: { access_token: 'verification-token' } },
    error: null,
  });
  verification.auth.updateUser.mockResolvedValue({ data: { user: owner }, error: null });
  verification.auth.signOut.mockResolvedValue({ error: null });
  photos = fakeSupabase();
  lock.mockResolvedValue({ error: null });
  deleteUser.mockResolvedValue({ error: null });
  admin = {
    storage: photos.client.storage,
    from: vi.fn(() => ({ upsert: lock })),
    auth: { admin: { deleteUser } },
  } as unknown as SupabaseClient;
  vi.mocked(createClient).mockImplementation(
    (_url, key) =>
      (key === 'server-secret'
        ? admin
        : { auth: { ...identity.auth, ...verification.auth } }) as unknown as ReturnType<
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
const deletion = { currentPassword: 'current-secret', acknowledged: true };
async function expectError(result: Response, code: string, status?: number) {
  expect(await result.json()).toEqual({ error: { code } });
  if (status) expect(result.status).toBe(status);
  expect(result.headers.get('cache-control')).toBe('no-store');
}

it('requires a bearer token and rejects an expired identity before password verification', async () => {
  await expectError(await PATCH(request('PATCH', password, '')), 'sessionExpired', 401);
  identity.auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { code: 'bad_jwt' } });
  await expectError(await DELETE(request('DELETE', deletion)), 'sessionExpired', 401);
  expect(verification.auth.signInWithPassword).not.toHaveBeenCalled();
});
describe.each([
  ['email', email],
  ['password', password],
  ['deletion', deletion],
] as const)('%s authorization', (kind, input) => {
  const invoke = (body: unknown) =>
    kind === 'deletion' ? DELETE(request('DELETE', body)) : PATCH(request('PATCH', body));
  it('rejects incorrect current passwords without any account mutation', async () => {
    verification.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { code: 'invalid_credentials' },
    });
    await expectError(await invoke(input), 'currentPasswordIncorrect', 403);
    expect(verification.auth.updateUser).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
    expect(lock).not.toHaveBeenCalled();
  });
  it('rejects mismatched reauthenticated identities and ends their temporary session', async () => {
    verification.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: account('different-user'), session: {} },
      error: null,
    });
    await expectError(await invoke(input), 'sessionExpired', 403);
    expect(verification.auth.updateUser).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
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
it('rejects malformed, oversized, weak, and unacknowledged requests', async () => {
  await expectError(
    await PATCH(request('PATCH', { ...password, newPassword: 'short' })),
    'accountInput',
  );
  await expectError(
    await DELETE(request('DELETE', { ...deletion, acknowledged: false })),
    'accountInput',
  );
  await expectError(
    await PATCH(request('PATCH', { ...password, currentPassword: 'x'.repeat(9000) })),
    'accountInput',
  );
});
it('hard deletes an account with no photos only after installing the write fence', async () => {
  expect((await DELETE(request('DELETE', deletion))).status).toBe(200);
  expect(lock).toHaveBeenCalledWith({ user_id: owner.id });
  expect(deleteUser).toHaveBeenCalledWith(owner.id, false);
  expect(lock.mock.invocationCallOrder[0]).toBeLessThan(deleteUser.mock.invocationCallOrder[0]);
});
it('waits for the metadata commit barrier before listing photos or deleting Auth', async () => {
  let release!: () => void;
  lock.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ error: null });
      }),
  );
  const pending = DELETE(request('DELETE', deletion));
  await vi.waitFor(() => expect(lock).toHaveBeenCalled());
  expect(photos.bucket.list).not.toHaveBeenCalled();
  expect(deleteUser).not.toHaveBeenCalled();
  photos.photos.set(`${owner.id}/late-upload.webp`, new Blob(['late']));
  release();
  expect((await pending).status).toBe(200);
  expect(photos.photos.size).toBe(0);
  expect(deleteUser).toHaveBeenCalledWith(owner.id, false);
});
it('enumerates nested orphan photos across pages before removal, preserving other owners', async () => {
  for (let i = 0; i < 205; ++i)
    photos.photos.set(`${owner.id}/visit/${String(i).padStart(3, '0')}.webp`, new Blob(['photo']));
  photos.photos.set(`${owner.id}/orphan.webp`, new Blob(['orphan']));
  photos.photos.set('other-user/visit/keep.webp', new Blob(['keep']));
  expect((await DELETE(request('DELETE', deletion))).status).toBe(200);
  expect([...photos.photos.keys()]).toEqual(['other-user/visit/keep.webp']);
  expect(photos.bucket.list.mock.calls.map(([, options]) => options.offset)).toContain(200);
  expect(photos.bucket.remove).toHaveBeenCalledTimes(3);
  expect(photos.bucket.list.mock.invocationCallOrder.at(-1)!).toBeLessThan(
    photos.bucket.remove.mock.invocationCallOrder[0],
  );
});
it('retains Auth and the fence after partial cleanup failure, then allows retry', async () => {
  for (let i = 0; i < 150; ++i) photos.photos.set(`${owner.id}/${i}.webp`, new Blob(['photo']));
  const remove = photos.bucket.remove.getMockImplementation()!;
  photos.bucket.remove
    .mockImplementationOnce(remove)
    .mockResolvedValueOnce({ error: new Error('Storage offline') });
  await expectError(await DELETE(request('DELETE', deletion)), 'accountDeletionFailed', 502);
  expect(photos.photos.size).toBe(50);
  expect(deleteUser).not.toHaveBeenCalled();
  await removeAccountPhotos(admin, owner.id);
  expect(photos.photos.size).toBe(0);
});
it('never reports success on Auth failure or a lost deletion response', async () => {
  deleteUser.mockRejectedValueOnce(new Error('Lost response'));
  await expectError(await DELETE(request('DELETE', deletion)), 'accountDeletionFailed', 502);
});
it('does not start cleanup without the server secret or a successful fence', async () => {
  vi.stubEnv('SUPABASE_SECRET_KEY', '');
  await expectError(await DELETE(request('DELETE', deletion)), 'accountDeletionUnavailable', 503);
  expect(photos.bucket.list).not.toHaveBeenCalled();
});

it('retains Auth after listing/fence failures and rejects malformed storage paths', async () => {
  lock.mockResolvedValueOnce({ error: new Error('Database unavailable') });
  await expectError(await DELETE(request('DELETE', deletion)), 'accountDeletionFailed');
  expect(photos.bucket.list).not.toHaveBeenCalled();
  photos.bucket.list.mockResolvedValueOnce({ data: [], error: new Error('Storage unavailable') });
  await expectError(await DELETE(request('DELETE', deletion)), 'accountDeletionFailed');
  expect(deleteUser).not.toHaveBeenCalled();
  photos.bucket.list.mockResolvedValueOnce({
    data: [{ name: '../victim.webp', id: 'id' }],
    error: null,
  });
  await expect(removeAccountPhotos(admin, owner.id)).rejects.toMatchObject({
    code: 'accountDeletionFailed',
  });
  expect(photos.bucket.remove).not.toHaveBeenCalled();
});

it('reports temporary-session cleanup failure and password revocation failure without false success', async () => {
  verification.auth.signOut.mockResolvedValueOnce({ error: new Error('Offline') });
  await expectError(await PATCH(request('PATCH', email)), 'accountSessionCleanup', 502);
  verification.auth.signOut.mockResolvedValueOnce({ error: new Error('Offline') });
  await expectError(await PATCH(request('PATCH', password)), 'sessionRevocation', 502);
});
