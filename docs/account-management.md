# Password recovery and account settings

For [ZEN-10](https://linear.app/zenzontle/issue/ZEN-10/account-recovery-and-management), email/password accounts support recovery, confirmation resend, and an Account dialog beside Sign out, including cloud-load failures. Settings let users change their email or password. All app copy is available in English and Spanish. Prototype mode still works without Supabase.

## Release setup

1. Configure the existing public Supabase URL and publishable key. These account features require no additional database migrations or server secret.
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

## Disposable-account smoke test

- Request recovery for existing and unknown emails and compare generic app copy. Test a valid, expired, reused link, a reload, delayed hydration, and closing the recovery tab before reopening the app. Verify callback tokens/errors disappear from the URL. Normal sessions visiting the recovery route show another-request controls. Sign in to a replacement account from another tab while password completion waits for the Auth lock; that replacement must remain signed in.
- Check password mismatch, provider weak-password rejection, throttling, network failure, resend cooldown, signup notice, and `email_not_confirmed`. Verify both languages and keyboard focus at desktop/mobile widths.
- Reject missing/expired bearer tokens, wrong current passwords, extra target IDs, and mismatched reauthenticated identities. Confirm email change requires both emails and updates same-ID metadata without reloading the garage.
- After password change/reset, verify the old password fails, the new one signs in, refresh tokens cannot renew, and guest records/photos and locale are unchanged.

Unit/component tests use fake Supabase clients and real-SDK tests with mocked HTTP responses. They do not substitute for real provider delivery, password verification, or access-token expiry checks.
