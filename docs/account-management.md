# Password recovery, account settings, and deletion

Email/password accounts support recovery and confirmation resend. The avatar menu opens `/settings/account` to show the current email and `/settings/security` to change the email or password. Signed-out users can sign in and return to either page. An Account dialog beside Sign out remains available after cloud-load failures. All app copy is available in English and Spanish. Prototype mode still works without Supabase.

## Release setup

1. Configure the existing public Supabase URL and publishable key. Recovery and email/password changes require no additional database migrations or server secret; account deletion does (see [deletion release setup](#deletion-release-setup)).
2. Set Supabase Auth's Site URL and allow **exact** redirect URLs for each deployment origin: `https://your-origin/auth/recovery` and `https://your-origin/`. Include `http://localhost:3000/auth/recovery` and `http://localhost:3000/` for development. Keep secure email-change confirmation enabled (confirm both old and new addresses). Use the provider's existing recovery/confirmation templates and language.
3. Smoke-test real email delivery and email/password changes with disposable accounts before release.

The browser sends recovery and confirmation-resend email requests to Supabase, with redirects built from the current origin and fixed paths. Confirmation resend has a shared 60-second cooldown, including failed attempts. Provider auth rate limits remain authoritative. The project recovery marker uses localStorage alongside the persisted Auth session, so restrictions survive closing the recovery tab and reopening the app. It contains only the user identity, JWT session ID, and revocation-retry status, never credentials; existing tab-only markers migrate when read. Completion, cancellation, sign-out, or a new identity/session clears the marker. An ordinary signed-in visit to `/auth/recovery` cannot reset a password. An invalid callback preserves restrictions on an existing session-bound recovery session. Recovery suspends pending signup transfer until ordinary sign-in resumes it.

Recovery bootstrap starts when the browser client is created. It captures the callback before Supabase clears the URL and, after successful initialization, binds the matching session before the hook handles `INITIAL_SESSION` or loads a garage. A client-lifetime auth observer also records recovery events before React subscribes, so delayed hydration cannot lose the restriction. Failed callbacks and replacement logins do not create a new recovery binding.

## API contract

`PATCH /api/account` accepts exactly one of:

```json
{ "kind": "email", "currentPassword": "...", "newEmail": "next@example.com" }
```

```json
{ "kind": "password", "currentPassword": "...", "newPassword": "..." }
```

Requests require `Authorization: Bearer <access token>`, return `Cache-Control: no-store`, reject extra fields (including target IDs), and cap request bodies at 8 KiB. Identity and email come from Supabase `getUser(token)`. A separate nonpersistent client verifies the current password and matching user ID before `updateUser`. Temporary verification sessions are signed out locally. Responses contain only a status or `{ "error": { "code": "stableAppFailureCode" } }`, never passwords, tokens, or raw provider errors.

Email requests return `confirmationRequired`; the browser refreshes user metadata and shows the current and pending addresses until confirmation completes. Password requests return `passwordChanged` after revoking refresh sessions. If update succeeds but revocation fails, retry with the new password as both current and desired password: after verifying identity and that password, `same_password` is accepted and global revocation is attempted again. Other update errors still fail.

Reset validates the recovery session's user and JWT session ID and performs `updateUser` while holding the shared Auth lock, then globally signs out that bound session. Cancellation uses a bound local sign-out under the same lock, preserving a replacement login from another tab. Both password completion paths also revalidate the binding under the lock before signing out. If the recovery session remains available after failed revocation, retry does not repeat the password update, including after closing and reopening the app. If Supabase clears the session on failure, the page displays the revocation error and offers sign-in with the new password; it never claims sessions were revoked. Already-issued access tokens can remain valid until expiry; this is not immediate sign-out on every device.

The browser client explicitly configures the SDK Auth lock and serializes password sign-in/signup session writes with it. This uses the installed Supabase v2 SDK's private lock/session methods behind a guarded adapter; rerun the real-SDK concurrency tests before upgrading, especially to v3. Signup registration, transfer verification, and guest cleanup share a project-scoped transfer lock. Pending signup transfers block email/password changes; ordinary sign-in does not import guest records.

## Account deletion

**Delete account** on `/settings/security` and in the Account dialog permanently deletes the signed-in account and all of its cloud data: vehicles, schedules, visits, fill-ups, receipts and conversions, photos, garage and notification settings, and reminder delivery records. The form explains what is lost, suggests a CSV export first, and requires the current password and an acknowledgement checkbox. Pending signup transfers and recovery sessions block it, like other account changes. Guest records kept in the browser without an account are not touched.

### Deletion queue

Deletion is an asynchronous order, not a single request, so a partial failure can never leave an account half-deleted and forgotten:

1. `DELETE /api/account` reauthenticates the caller exactly like `PATCH` (bearer token, then the current password on a nonpersistent client) and calls `request_account_deletion`. In one transaction this inserts a row in `public.account_deletion_requests` (idempotent) and disables weekly email reminders. Once that row exists, deletion always completes.
2. The account is banned through the Auth admin API, so it cannot sign in or refresh a token while the order is queued (sign-in then reports `accountDeletionPending`). Every refresh session is revoked with a global sign-out.
3. The API tries to complete the order immediately, within 25 seconds. The worker leases the order (`claim_account_deletions`, `for update skip locked` with a two-minute lease), removes every object in the account's `visit-photos/<user id>/` folder through the Storage API in pages of 1,000 (`account_photo_paths`), then deletes the Auth user. Foreign keys cascade that deletion to every owner table, including the order itself. Supabase refuses to delete a user who still owns Storage objects, so photos always go first.
4. The response is `{ "status": "accountDeleted" }` (200), or `{ "status": "deletionScheduled" }` (202) when the order stays queued. The browser then clears its offline receipt cache for the account, signs out locally (only if the stored session still belongs to the deleted account), and shows the matching notice.
5. `GET /api/account-deletions`, protected by `Authorization: Bearer <CRON_SECRET>`, retries queued orders oldest first, ten per claim, for up to 40 seconds. Vercel runs it daily at `17 4 * * *`, so a queued deletion completes within about a day; a more frequent schedule needs a paid Vercel plan. A failed attempt records a `failure_code` and keeps its lease until it expires. The response and the `account_deletion_run` log contain only `deleted`, `failed`, and `deferred` counts. Unlike reminders, this job has no enable switch.

The queue table and its functions are server-only: row-level security is enabled with no policies, clients have no grants, and only `service_role` may execute the functions. Restrictive Storage policies reject photo uploads and replacements from an account with a queued order, or whose Auth user no longer exists, so an access token issued before deletion cannot add files afterward. Database rows cannot outlive their Auth user because of their foreign keys. Already-issued access tokens can still read until they expire.

Out of scope: transactional email already accepted by Brevo, and feedback reports in Linear, which carry only a pseudonymous reporter ID that cannot be traced back to the account. Feedback rate-limit and receipt keys in Redis expire on their own within a day.

### Deletion release setup

Apply `supabase/migrations/0013_account_deletion.sql` before deploying, then run `supabase/tests/account_deletion.sql` as an administrator. Configure server-only `SUPABASE_SECRET_KEY` and `CRON_SECRET` (shared with [account reminders](account-reminders.md#deployment)). Without the secret key, the endpoint returns `accountDeletionUnavailable` (503) before asking for a password.

Smoke-test with a disposable account that has vehicles, visits and fill-ups with photos, and reminders enabled: delete it and confirm that its rows, its `visit-photos` folder, and its Auth user are gone, and that another account's data is untouched. Then make the worker fail (for example, temporarily revoke the Storage API key), confirm a 202 response and that sign-in is refused, restore the key, call the cron route, and confirm the order completes.

## Disposable-account smoke test

- Request recovery for existing and unknown emails and compare generic app copy. Test a valid, expired, reused link, a reload, delayed hydration, and closing the recovery tab before reopening the app. Verify callback tokens/errors disappear from the URL. Normal sessions visiting the recovery route show another-request controls. Sign in to a replacement account from another tab while password completion waits for the Auth lock; that replacement must remain signed in.
- Check password mismatch, provider weak-password rejection, throttling, network failure, resend cooldown, signup notice, and `email_not_confirmed`. Verify both languages and keyboard focus at desktop/mobile widths.
- Reject missing/expired bearer tokens, wrong current passwords, extra target IDs, and mismatched reauthenticated identities. Confirm email change requires both emails and updates same-ID metadata without reloading the garage.
- After password change/reset, verify the old password fails, the new one signs in, refresh tokens cannot renew, and guest records/photos and locale are unchanged.

Unit/component tests use fake Supabase clients and real-SDK tests with mocked HTTP responses. They do not substitute for real provider delivery, password verification, or access-token expiry checks.
