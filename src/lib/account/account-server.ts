import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import {
  accountDeleteSchema,
  accountPatchSchema,
  type AccountDeletionStatus,
} from '@/lib/account/account-contract';
import { processAccountDeletion, requestAccountDeletion } from '@/lib/account/account-deletion';
import type { ErrorCode } from '@/lib/utils/app-error';

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
    // Requesting deletion bans the account until the queued order completes.
    user_banned: 'accountDeletionPending',
  };
  throw new AccountError(codes[error?.code ?? ''] ?? 'auth', 400);
}
const response = (body: object, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const failure = (cause: unknown) => {
  const error = cause instanceof AccountError ? cause : new AccountError('auth', 502);
  return response({ error: { code: error.code } }, error.status);
};

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

// The temporary password-verification session, closed after every request that opened one.
type Verification = { client?: SupabaseClient; open: boolean };

async function verifyCaller<Schema extends z.ZodType<{ currentPassword: string }>>(
  request: Request,
  schema: Schema,
  verification: Verification,
): Promise<{ input: z.infer<Schema>; user: User; client: SupabaseClient }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new AccountError('cloudNotConfigured', 503);
  const token = /^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token) throw new AccountError('sessionExpired', 401);
  const identity = createClient(url, key, authOptions);
  const { data: caller, error: identityError } = await identity.auth.getUser(token);
  if (identityError || !caller.user?.email) throw new AccountError('sessionExpired', 401);
  const parsed = schema.safeParse(await bodyOf(request));
  if (!parsed.success) throw new AccountError('accountInput');
  const input = parsed.data as z.infer<Schema>;
  const client = createClient(url, key, authOptions);
  verification.client = client;
  const { data, error } = await client.auth.signInWithPassword({
    email: caller.user.email,
    password: input.currentPassword,
  });
  verification.open = Boolean(data.session);
  if (error) {
    if (error.code === 'invalid_credentials')
      throw new AccountError('currentPasswordIncorrect', 403);
    providerError(error);
  }
  if (!data.user || data.user.id !== caller.user.id || !data.session)
    throw new AccountError('sessionExpired', 403);
  return { input, user: caller.user, client };
}

async function closeVerification(verification: Verification, result: Response) {
  if (verification.client && verification.open) {
    try {
      const { error } = await verification.client.auth.signOut({ scope: 'local' });
      if (error) return response({ error: { code: 'accountSessionCleanup' } }, 502);
    } catch {
      return response({ error: { code: 'accountSessionCleanup' } }, 502);
    }
  }
  return result;
}

export async function accountRequest(request: Request) {
  const verification: Verification = { open: false };
  const result = await (async () => {
    try {
      const { input, client } = await verifyCaller(request, accountPatchSchema, verification);
      const { error: updateError } = await client.auth.updateUser(
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
        const { error: revokeError } = await client.auth.signOut({ scope: 'global' });
        if (revokeError) throw new AccountError('sessionRevocation', 502);
      }
      return response({
        status: input.kind === 'email' ? 'confirmationRequired' : 'passwordChanged',
      });
    } catch (cause) {
      return failure(cause);
    }
  })();
  return closeVerification(verification, result);
}

// Leave time to answer within the 60-second function limit; the worker finishes the rest.
const INLINE_DELETION_MS = 25_000;

function serverClient(url: string, key: string, budget: AbortSignal) {
  return createClient(url, key, {
    ...authOptions,
    global: {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: AbortSignal.any([
            budget,
            AbortSignal.timeout(8_000),
            ...(init?.signal ? [init.signal] : []),
          ]),
        }),
    },
  });
}

export async function accountDeletionRequest(request: Request) {
  const verification: Verification = { open: false };
  const result = await (async () => {
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const secret = process.env.SUPABASE_SECRET_KEY;
      // Check before asking for the password: without the secret key nothing can be deleted.
      if (!url || !secret) throw new AccountError('accountDeletionUnavailable', 503);
      const { user, client } = await verifyCaller(request, accountDeleteSchema, verification);
      const deadline = Date.now() + INLINE_DELETION_MS;
      const db = serverClient(url, secret, AbortSignal.timeout(INLINE_DELETION_MS + 5_000));
      // The durable order comes first: once it exists, the deletion always completes.
      await requestAccountDeletion(db, user.id).catch(() => {
        throw new AccountError('accountDeletion', 502);
      });
      // Sign out every device, including this verification session. Deleting the user
      // removes all sessions too, so a failure here only matters while the order is queued.
      const revoked = await client.auth
        .signOut({ scope: 'global' })
        .then(({ error }) => !error)
        .catch(() => false);
      if (revoked) verification.open = false;
      const deleted = await processAccountDeletion(db, user.id, deadline).catch(() => false);
      // A deleted user has no session left to close.
      if (deleted) verification.open = false;
      const status: AccountDeletionStatus = deleted ? 'accountDeleted' : 'deletionScheduled';
      return response({ status }, deleted ? 200 : 202);
    } catch (cause) {
      return failure(cause);
    }
  })();
  if (!result.ok) return closeVerification(verification, result);
  // The order is durable; a cleanup failure must not make the browser keep the account open.
  await closeVerification(verification, result);
  return result;
}
