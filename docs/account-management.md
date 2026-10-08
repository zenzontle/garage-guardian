# Account recovery and management

For [ZEN-10](https://linear.app/zenzontle/issue/ZEN-10/account-recovery-and-management), email/password accounts support recovery, confirmation resend, and an Account dialog beside Sign out, including cloud-load failures. All app copy is available in English and Spanish. Prototype mode still works without Supabase.

## Release order

1. Apply `supabase/migrations/0006_account_deletion_photo_writes.sql` before deploying. It requires the previous migrations and restricts photo INSERT/UPDATE to the caller's prefix, an existing Auth user, and an account without a deletion fence. Owner-scoped reads/deletes remain in place.
2. Configure the server-only `SUPABASE_SECRET_KEY` along with the existing public URL/key. Never expose the secret through a public variable.
3. Set Supabase Auth's Site URL and allow **exact** redirect URLs for each deployment origin: `https://your-origin/auth/recovery` and `https://your-origin/`. Include `http://localhost:3000/auth/recovery` and `http://localhost:3000/` for development. Keep secure email-change confirmation enabled (confirm both old and new addresses). Use the provider's existing recovery/confirmation templates and language.
4. Run `supabase/tests/account_management.sql` against a disposable/test project; it rolls back its fixtures. Smoke-test real email delivery and deletion with disposable accounts before release.

The browser sends recovery and confirmation-resend email requests to Supabase, with redirects built from the current origin and fixed paths. Confirmation resend has a shared 60-second cooldown, including failed attempts. Provider auth rate limits remain authoritative. A tab's recovery marker contains only the project, user identity, and JWT session ID, never credentials. An ordinary signed-in visit to `/auth/recovery` cannot reset a password. Recovery suspends pending signup transfer until ordinary sign-in resumes it.

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

Email requests return `confirmationRequired`; the browser refreshes user metadata and shows the current and pending addresses until confirmation completes. Password requests return `passwordChanged` after revoking refresh sessions. Reset uses the recovery session's `updateUser` followed by global sign-out. If the recovery session remains available after failed revocation, retry does not repeat the password update, including after a same-tab reload. If Supabase clears the session on failure, the page displays the revocation error and offers sign-in with the new password; it never claims sessions were revoked. Already-issued access tokens can remain valid until expiry; this is not immediate sign-out on every device.

## Permanent deletion and retry

Deletion pauses new mutations in this tab and waits for its existing repository work. The server installs a durable `account_deletion_locks` row to prevent new photo uploads, including from other tabs. It enumerates all nested objects in the user's `visit-photos` prefix with pagination before deleting batches through the Storage API, including orphan uploads. Only then does it hard-delete Auth; foreign keys cascade cars, schedules, visits, reminder records, and the deletion fence.

A cleanup failure keeps Auth and the fence. Photos may have been partially removed; uploads stay paused until deletion is retried. A server interruption also leaves the fence, so a later retry can safely continue. Existing operations from other tabs that passed the write check before the fence may still finish; Auth deletion must succeed before success is reported. If Supabase rejects deletion because a late object remains, retry cleanup. A lost response is an **unknown outcome**, never a success notice: retry while signed in, or sign in again to check the account if the session expired. If needed, an administrator can inspect the user's Auth identity and Storage prefix before retrying. Do not blindly remove a fence while a deletion request may still be running.

After confirmed deletion, the browser clears account memory and only that account's signup-transfer marker, signs out locally, and restores guest records/photos and locale. Public GitHub bug reports and provider backups are outside deletion scope.

## Disposable-account smoke test

- Request recovery for existing and unknown emails and compare generic app copy. Test a valid, expired, reused link and a reload in the same tab. Verify callback tokens/errors disappear from the URL. Normal sessions visiting the recovery route show another-request controls.
- Check password mismatch, provider weak-password rejection, throttling, network failure, resend cooldown, signup notice, and `email_not_confirmed`. Verify both languages and keyboard focus at desktop/mobile widths.
- Reject missing/expired bearer tokens, wrong passwords for every operation, extra target IDs, and mismatched reauthenticated identities. Confirm email change requires both emails and updates same-ID metadata without reloading the garage.
- After password change/reset, verify the old password fails, the new one signs in, refresh tokens cannot renew, and guest data is unchanged.
- Delete with no photos, hundreds of files, and orphan uploads. Interrupt cleanup and retry. Try a concurrent upload from another tab and an upload with a stale token after deletion. Verify all cascaded rows vanish, another user's records/photos remain, and guest photos/locale survive.

Unit/component tests use fake Supabase and Storage clients; they do not substitute for real provider delivery, database-policy execution, cascades, password verification, or access-token expiry checks.
