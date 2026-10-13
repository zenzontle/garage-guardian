# Account email reminders

Email reminders are opt-in for signed-in cloud accounts. Existing and newly created accounts start disabled. Account settings and `/settings/notifications` share the same form: enabled, weekday (Sunday = 0), and English/Spanish email language. The first form load uses the current app language when no preference record exists; subsequent browser language changes do not change the saved email language. The recipient is always the current confirmed Supabase account email, never a pending replacement address.

## Deployment

1. Keep `REMINDERS_ENABLED=false` while deploying. Apply `supabase/migrations/0007_account_reminders.sql` before deploying the new application code. Do not roll back to the old sender after migrating: its delivery inserts no longer describe the new workflow.
2. Configure server-only `SUPABASE_SECRET_KEY`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, and a random `CRON_SECRET`, alongside the existing public Supabase configuration. Configure `REMINDER_APP_ORIGIN` as the deployment's exact public HTTPS origin. Paths, credentials, query strings, and fragments are rejected. The old `REMINDER_TO_EMAIL` variable is no longer used and can be removed.
3. Use a separate staging database and verified Brevo sender. Run the SQL checks below and opt in two staging accounts, one per language, with different vehicles and tasks. Confirm both HTML and plain-text emails, units, dates, current recipient, vehicle links, settings link, and sign-in return destinations. Opt out one account and confirm it stops receiving digests. Never enable production sending until this staging check is complete.
4. Set `REMINDERS_ENABLED=true` only in the intended deployment. Missing credentials while enabled produce a configuration error. The job is protected by `Authorization: Bearer <CRON_SECRET>`. Vercel's daily schedule remains `0 16 * * *`; exact delivery time is not guaranteed.
5. To stop sending, set `REMINDERS_ENABLED=false` and redeploy. Preferences remain saved. Already accepted messages cannot be recalled.

## Scheduling and delivery semantics

- Enabling reminders schedules the next strictly future occurrence of the chosen weekday at 16:00 UTC. Disabling clears it. Changing weekday recalculates the schedule; changing language does not. Consent time is recorded when enabling, including re-enrollment.
- The daily job selects scheduled enabled accounts oldest first, pages 50 accounts at a time, and processes at most three concurrently. It stops starting new accounts after 30 seconds, caps individual database requests at five seconds and the database workload at 48 seconds, and caps provider requests at eight seconds. The function has a 60-second maximum. Unclaimed work stays scheduled for the next run; deferred counts expose capacity problems.
- An atomic database function locks each preference row, inserts a unique `(user_id, week_start)` claim, and advances the schedule. Weeks start Monday UTC. Duplicate cron invocations and changing weekday cannot create a second digest in the same week. Missed periods collapse into one current digest. Empty or ineligible digests consume that week's claim too.
- Each account is fetched by ID. All maintenance queries include its user ID and page past database row limits. Active upcoming/due tasks use the existing maintenance calculations, date-only UTC handling, vehicle reminder windows, and recorded odometers. No estimated mileage is used.
- The worker rechecks opt-in and fetches current confirmed account email immediately before sending. An opt-out cannot recall an email already submitted to Brevo.
- Delivery state is `processing`, `accepted`, `failed`, `unknown`, or `skipped`. `accepted` means a successful Brevo API response, **not** inbox delivery. A valid optional provider message ID is retained. Explicit client-error responses are failures; timeouts, HTTP 408/server errors, and abandoned processing claims have unknown outcomes. Abandoned claims are marked unknown after ten minutes on the next run.
- No attempted digest is automatically resent, even after an error saving its outcome. The next weekly digest is independent. Do not delete claims to retry a message whose outcome is unknown; inspect the provider's records instead. Webhooks, bounce reconciliation, and a user-visible history are outside this release.
- Legacy rows remain `unknown` with `failure_code=legacy_unverified`; their old timestamp is retained as `attempted_at`. `sent_at` is retained for schema compatibility but cleared and unused because it never proved delivery.
- Delivery rows are server-only, cascade on account deletion, and are deleted after 90 days by enabled cron runs. A disabled job also pauses that cleanup. No recipient addresses or rendered bodies are stored in application delivery rows or logs.

## API

`GET /api/notification-preferences` requires a Supabase access token and returns `{ preferences: null }` for an account without settings, or `{ preferences: { enabled, weekday, emailLanguage, nextScheduledAt } }`. Null means disabled, with Monday and the current UI language as form defaults.

`PATCH` accepts a nonempty subset of `{ enabled: boolean, weekday: 0..6, emailLanguage: "en" | "es" }`. Omitted fields are preserved; a new record uses database defaults for omitted fields. It returns the same preference shape. Owner ID, consent, and schedule fields are never writable through this API. Responses are uncached and errors use `{ error: { code } }`, with 400 for invalid input, 401 for invalid sessions, 413 for oversized bodies, 503 for missing Supabase configuration, and 502 for persistence failures. Row-level security and column grants also enforce ownership and protect server fields on direct database requests.

## Verification and operations

Run `supabase/tests/account_reminders.sql` as a database administrator against a staging database after migrations. It creates two test users in a transaction and rolls everything back. It checks account isolation, restricted fields, consent/defaults, all weekdays and year boundaries, duplicate claims, missed periods, opt-out, and account deletion. For a true concurrent database check, make the same test account overdue and call `claim_reminder` from two database sessions at once: exactly one may return a week, with one delivery row.

Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, and `pnpm build`. Run repository-installed Prettier on changed supported files. The automated sender tests stub Brevo; they never send real email.

The cron response and `reminder_run` log contain only aggregate accepted, failed, unknown, skipped, deferred, and errors counts. A persistence error produces `partial_failure`/502; a global job failure produces `reminderRunFailed`/502. Provider failures appear in outcome counts without aborting other accounts. Investigate any errors, persistent failures/unknowns, or a deferred backlog that grows across runs. Increase processing capacity before increasing enrollment if the backlog does not clear.

Use administrator SQL to inspect operational state without exposing it to users:

```sql
select status, failure_code, count(*)
from public.reminder_deliveries
where attempted_at >= now() - interval '7 days'
group by status, failure_code;

select count(*) as deferred, min(next_scheduled_at) as oldest_due
from public.notification_preferences
where enabled and next_scheduled_at <= now();

select user_id, week_start, status, attempted_at, completed_at,
       item_count, provider_message_id, failure_code
from public.reminder_deliveries
where status in ('failed', 'unknown', 'processing')
order by attempted_at desc
limit 100;
```
