import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { accountDeleteSchema, accountPatchSchema } from '@/lib/account-contract';
import type { ErrorCode } from '@/lib/app-error';

const authOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};
class AccountError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status = 400,
  ) {
    super(code);
  }
}
function providerError(error: { code?: string } | null): never {
  const codes: Record<string, ErrorCode> = {
    weak_password: 'weakPassword',
    same_password: 'samePassword',
    email_exists: 'accountExists',
    over_request_rate_limit: 'rateLimited',
    over_email_send_rate_limit: 'rateLimited',
  };
  throw new AccountError(codes[error?.code ?? ''] ?? 'auth', 400);
}
const response = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function bodyOf(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new AccountError('accountInput');
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 8192) {
        await reader.cancel();
        throw new AccountError('accountInput', 413);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (cause) {
    if (cause instanceof AccountError) throw cause;
    throw new AccountError('accountInput');
  }
}

export async function accountRequest(request: Request, deleting: boolean) {
  let verification: SupabaseClient | undefined;
  let verified = false;
  let deleted = false;
  const result = await (async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if (!url || !key) throw new AccountError('cloudNotConfigured', 503);
      const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
      if (!token) throw new AccountError('sessionExpired', 401);
      const identity = createClient(url, key, authOptions);
      const { data: caller, error: identityError } = await identity.auth.getUser(token);
      if (identityError || !caller.user?.email) throw new AccountError('sessionExpired', 401);
      const parsed = (deleting ? accountDeleteSchema : accountPatchSchema).safeParse(
        await bodyOf(request),
      );
      if (!parsed.success) throw new AccountError('accountInput');
      const input = parsed.data;
      verification = createClient(url, key, authOptions);
      const { data, error } = await verification.auth.signInWithPassword({
        email: caller.user.email,
        password: input.currentPassword,
      });
      verified = Boolean(data.session);
      if (error) {
        if (error.code === 'invalid_credentials')
          throw new AccountError('currentPasswordIncorrect', 403);
        providerError(error);
      }
      if (!data.user || data.user.id !== caller.user.id || !data.session)
        throw new AccountError('sessionExpired', 403);
      if ('kind' in input) {
        const { error: updateError } = await verification.auth.updateUser(
          input.kind === 'email' ? { email: input.newEmail } : { password: input.newPassword },
        );
        // A prior request may have changed the password before revocation failed.
        // Reauthentication proves the requested password is already in effect.
        const passwordAlreadyChanged =
          input.kind === 'password' &&
          input.currentPassword === input.newPassword &&
          updateError?.code === 'same_password';
        if (updateError && !passwordAlreadyChanged) providerError(updateError);
        if (input.kind === 'password') {
          const { error: revokeError } = await verification.auth.signOut({ scope: 'global' });
          if (revokeError) throw new AccountError('sessionRevocation', 502);
        }
        return response({
          status: input.kind === 'email' ? 'confirmationRequired' : 'passwordChanged',
        });
      }
      const secret = process.env.SUPABASE_SECRET_KEY;
      if (!secret) throw new AccountError('accountDeletionUnavailable', 503);
      const admin = createClient(url, secret, authOptions);
      const userId = caller.user.id;
      // Wait for photo metadata transactions, then fence all later commits.
      const { error: lockError } = await admin
        .from('account_deletion_locks')
        .upsert({ user_id: userId });
      if (lockError) throw new AccountError('accountDeletionFailed', 502);
      try {
        await removeAccountPhotos(admin, userId);
        const { error: deleteError } = await admin.auth.admin.deleteUser(userId, false);
        if (deleteError) throw new AccountError('accountDeletionFailed', 502);
        deleted = true;
      } catch {
        // A failed/lost response may already have deleted Auth. Never claim success here.
        // Keep the fence until a retry succeeds, including when this process is interrupted.
        throw new AccountError('accountDeletionFailed', 502);
      }
      return response({ status: 'deleted' });
    } catch (cause) {
      const error = cause instanceof AccountError ? cause : new AccountError('auth', 502);
      return response({ error: { code: error.code } }, error.status);
    }
  })();
  if (verification && verified) {
    try {
      const { error } = await verification.auth.signOut({ scope: 'local' });
      if (error && !deleted) return response({ error: { code: 'accountSessionCleanup' } }, 502);
    } catch {
      if (!deleted) return response({ error: { code: 'accountSessionCleanup' } }, 502);
    }
  }
  return result;
}

export async function removeAccountPhotos(admin: SupabaseClient, userId: string) {
  const bucket = admin.storage.from('visit-photos');
  const paths: string[] = [];
  const folders = [userId];
  // Enumerate before deleting so offsets never skip files as pages shrink.
  while (folders.length) {
    const folder = folders.pop()!;
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await bucket.list(folder, {
        limit: 100,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error || !data) throw new AccountError('accountDeletionFailed', 502);
      for (const item of data) {
        if (!item.name || item.name === '.' || item.name === '..' || /[/\\]/.test(item.name))
          throw new AccountError('accountDeletionFailed', 502);
        const path = `${folder}/${item.name}`;
        if (item.id) paths.push(path);
        else folders.push(path);
      }
      if (data.length < 100) break;
    }
  }
  for (let start = 0; start < paths.length; start += 100) {
    const { error } = await bucket.remove(paths.slice(start, start + 100));
    if (error) throw new AccountError('accountDeletionFailed', 502);
  }
}
