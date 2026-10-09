# Account recovery and management

For [ZEN-10](https://linear.app/zenzontle/issue/ZEN-10/account-recovery-and-management), email/password accounts support recovery, confirmation resend, and an Account dialog beside Sign out, including cloud-load failures. All app copy is available in English and Spanish. Prototype mode still works without Supabase.

## Release order

1. Apply `supabase/migrations/0006_account_deletion_photo_writes.sql` and `0007_account_deletion_barrier.sql` before deploying. They require the previous migrations and restrict photo INSERT/UPDATE to the caller's prefix, an existing Auth user, and an account without a deletion fence. The upgrade adds triggers that drain earlier metadata commits before fence installation and guard elevated Storage completion writes. Owner-scoped reads/deletes remain in place.
2. Configure the server-only `SUPABASE_SECRET_KEY` along with the existing public URL/key. Never expose the secret through a public variable.
3. Set Supabase Auth's Site URL and allow **exact** redirect URLs for each deployment origin: `https://your-origin/auth/recovery` and `https://your-origin/`. Include `http://localhost:3000/auth/recovery` and `http://localhost:3000/` for development. Keep secure email-change confirmation enabled (confirm both old and new addresses). Use the provider's existing recovery/confirmation templates and language.
4. Run `supabase/tests/account_management.sql` against a disposable/test project; it rolls back its fixtures. Smoke-test real email delivery and deletion with disposable accounts before release.

The browser sends recovery and confirmation-resend email requests to Supabase, with redirects built from the current origin and fixed paths. Confirmation resend has a shared 60-second cooldown, including failed attempts. Provider auth rate limits remain authoritative. The project recovery marker uses localStorage alongside the persisted Auth session, so restrictions survive closing the recovery tab and reopening the app. It contains only the user identity, JWT session ID, and revocation-retry status, never credentials; existing tab-only markers migrate when read. Completion, cancellation, sign-out, or a new identity/session clears the marker. An ordinary signed-in visit to `/auth/recovery` cannot reset a password. An invalid callback preserves restrictions on an existing session-bound recovery session. Recovery suspends pending signup transfer until ordinary sign-in resumes it.

## API contract

`PATCH /api/account` accepts exactly one of:

```json
{ "kind": "email", "currentPassword": "...", "newEmail": "next@example.com" }
```

```json
{ "kind": "password", "currentPassword": "...", "newPassword": "..." }
```

`DELETE /api/account` accepts:

```json
{ "currentPassword": "...", "acknowledged": true }
```

Both require `Authorization: Bearer <access token>`, return `Cache-Control: no-store`, reject extra fields (including target IDs), and cap request bodies at 8 KiB. Identity and email come from Supabase `getUser(token)`. A separate nonpersistent client verifies the current password and matching user ID before `updateUser` or deletion. Temporary verification sessions are signed out locally. Responses contain only a status or `{ "error": { "code": "stableAppFailureCode" } }`, never passwords, tokens, or raw provider errors.

Email requests return `confirmationRequired`; the browser refreshes user metadata and shows the current and pending addresses until confirmation completes. Password requests return `passwordChanged` after revoking refresh sessions. If update succeeds but revocation fails, retry with the new password as both current and desired password: after verifying identity and that password, `same_password` is accepted and global revocation is attempted again. Other update errors still fail. Reset validates the recovery session's user and JWT session ID and performs `updateUser` while holding the shared Auth lock, then globally signs out that bound session. Cancellation uses a bound local sign-out under the same lock, preserving a replacement login from another tab. Both password completion paths also revalidate the binding under the lock before signing out. If the recovery session remains available after failed revocation, retry does not repeat the password update, including after closing and reopening the app. If Supabase clears the session on failure, the page displays the revocation error and offers sign-in with the new password; it never claims sessions were revoked. Already-issued access tokens can remain valid until expiry; this is not immediate sign-out on every device.

## Permanent deletion and retry

Deletion requires browser Web Locks. If they are unavailable, the client rejects deletion before sending the DELETE request; the transfer helper's in-memory fallback does not coordinate separate tabs.

Deletion pauses new mutations in this tab and waits for its existing repository work. Signup holds the project signup-transfer Web Lock from before the provider request until its transfer marker is registered. Deletion acquires that same lock, waits for any running transfer to finish, and rechecks the marker before contacting the server; an unfinished transfer for the account blocks deletion. The server upserts the verified user ID into `account_deletion_locks`. The fence's BEFORE INSERT/UPDATE trigger takes an exclusive Auth row lock, waits for earlier photo metadata commits, then allows the durable fence to be installed. A BEFORE INSERT/UPDATE trigger on `storage.objects` takes a shared Auth row lock and rechecks the fence with a fresh snapshot, including elevated Storage completion writes. Both triggers require Read Committed (or equivalent Read Uncommitted) isolation and fail closed at stronger isolation levels. The server starts listing only after the barrier commits. The existing upsert contract also protects the previous endpoint version during rollout. It drains the first page of every nested folder in the user's `visit-photos` prefix through the Storage API, including orphan uploads, and rechecks parents until empty. Concurrent owner deletes cannot shift surviving entries past a listing offset. Only then does it hard-delete Auth; foreign keys cascade cars, schedules, visits, reminder records, and the deletion fence.

[Supabase's uploader](https://github.com/supabase/storage/blob/master/src/storage/uploader.ts) checks permission before byte transfer and completes metadata through an elevated connection; RLS alone cannot fence that later write. Earlier metadata transactions drain before cleanup, while later completion transactions are rejected by the trigger even if their permission probe succeeded. Supabase schedules cleanup of the rejected upload's backing object. This does not promise immediate erasure of provider backups or internal failed-upload staging data. PostgreSQL's [row locks](https://www.postgresql.org/docs/current/explicit-locking.html) and [volatile-function snapshots](https://www.postgresql.org/docs/current/xfunc-volatility.html) provide the barrier and fresh fence check.

A cleanup failure keeps Auth and the fence. Photos may have been partially removed; uploads stay paused until deletion is retried. A server interruption also leaves the fence, so a later retry can safely continue. Auth deletion must succeed before success is reported. A lost response is an **unknown outcome**, never a success notice: retry while signed in, or sign in again to check the account if the session expired. If needed, an administrator can inspect the user's Auth identity and Storage prefix before retrying. Do not blindly remove a fence while a deletion request may still be running.

After confirmed deletion, the browser records the deleted account ID in a project-scoped localStorage cleanup journal, then attempts to clear only that account's signup-transfer marker. Later signup and transfer checks retry a failed IndexedDB cleanup, including after reload, before the stale marker can block signup or remove guest data. Journal entries contain no credentials; unavailable localStorage leaves an in-memory retry. It signs out locally and verifies the local session is gone. Identity validation, sign-out, fallback credential removal, and notifications run under the same project-scoped Web Lock as other auth work. The browser client explicitly configures the SDK lock and serializes password sign-in/signup session writes with it; lock acquisition never steals an active lock on timeout. If sign-out retains credentials, it removes only the deleted account's explicit project-scoped Auth storage entries and rechecks through the SDK. A different account's credentials are never removed. Unavailable Auth storage or Web Locks produces a bilingual cleanup error instead of a completion notice. This uses the installed Supabase v2 SDK's private lock/session methods behind a guarded adapter; rerun the real-SDK concurrency tests before upgrading, especially to v3. On successful cleanup, it clears account memory and restores guest records/photos and locale. Public GitHub bug reports and provider backups are outside deletion scope.

## Disposable-account smoke test

- Request recovery for existing and unknown emails and compare generic app copy. Test a valid, expired, reused link, a reload, and closing the recovery tab before reopening the app. Verify callback tokens/errors disappear from the URL. Normal sessions visiting the recovery route show another-request controls. Sign in to a replacement account from another tab while password completion waits for the Auth lock; that replacement must remain signed in.
- Check password mismatch, provider weak-password rejection, throttling, network failure, resend cooldown, signup notice, and `email_not_confirmed`. Verify both languages and keyboard focus at desktop/mobile widths.
- Reject missing/expired bearer tokens, wrong passwords for every operation, extra target IDs, and mismatched reauthenticated identities. Confirm email change requires both emails and updates same-ID metadata without reloading the garage.
- After password change/reset, verify the old password fails, the new one signs in, refresh tokens cannot renew, and guest data is unchanged.
- Delete with no photos, hundreds of files, and orphan uploads. Interrupt cleanup and retry. Try a concurrent upload from another tab and an upload with a stale token after deletion. Verify all cascaded rows vanish, another user's records/photos remain, and guest photos/locale survive.

Unit/component tests use fake Supabase and Storage clients; they do not substitute for real provider delivery, database-policy execution, cascades, password verification, or access-token expiry checks.

## Two-connection barrier check

Use a fresh disposable Auth user per case after applying both migrations, with its ID substituted for `USER_UUID`. In an elevated SQL connection A, run `BEGIN; INSERT INTO storage.objects (bucket_id, name) VALUES ('visit-photos', 'USER_UUID/barrier-test.webp');` and keep the transaction open. In connection B, run `INSERT INTO public.account_deletion_locks (user_id) VALUES ('USER_UUID');`. It must wait until A commits; after `COMMIT` in A, B must return with the photo visible to enumeration and the fence installed. Repeat with an UPDATE of an existing photo.

Also test the reverse order: B runs `BEGIN; INSERT INTO public.account_deletion_locks (user_id) VALUES ('USER_UUID');` without committing. An elevated INSERT in A must wait; after B commits, A must fail with `42501`, never create metadata. Verify the same for an overwrite and a write after Auth deletion. The elevated connection simulates Storage's completion transaction, not just its user-scoped permission probe. Delete fixture photos through the Storage API and remove the disposable account when finished; do not run this against production accounts.
