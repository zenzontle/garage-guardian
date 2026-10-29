# Deployment and private cloud sync

Without environment variables the app runs in **local prototype mode** and saves records and compressed photos in the browser's IndexedDB. This mode has no account or cross-device sync and is intended for trying the workflow. Configure Supabase to add accounts and private cloud sync.

| Configuration         | Account             | Application data                           |
| --------------------- | ------------------- | ------------------------------------------ |
| No Supabase variables | No account required | Local prototype mode, browser IndexedDB    |
| Supabase configured   | Signed out          | Guest mode, browser IndexedDB              |
| Supabase configured   | Signed in           | Supabase database and private photo bucket |

## Setup

1. Create a free Supabase project. Apply every migration in `supabase/migrations` in order (see [Database migrations](#database-migrations)), using its SQL editor or the Supabase CLI.
2. In Supabase Auth, enable email/password authentication and **Allow new users to sign up**.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the project API settings in `.env.local` for local development, and in the hosting environment for deployment. Restart the app. Do not expose the service role key in a `NEXT_PUBLIC_` variable.
4. Deploy the Next.js app to a personal Vercel Hobby project. Add the two public Supabase variables there. The migrations enable owner-scoped row security and a private photo bucket.
5. Set Supabase Auth's **Site URL** to your app URL and allow your deployed URL and `http://localhost:3000` as confirmation redirect URLs. The app supports email confirmation being enabled or disabled. If confirmation is required, users can continue locally until they confirm their email and authenticate in the browser containing their guest data. Account recovery and email change need additional exact redirects; see [account management](account-management.md#release-setup).

## Database migrations

Apply migrations in numeric order, each **before** deploying the application code that depends on it. Deploy application writes only after the migration succeeds. Run the listed SQL check as an administrator after migrating, against staging first where the feature guide says so; each check rolls back its fixtures.

| Migration                          | Adds                                                                                                                   | SQL check                                  | Details                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------- |
| `0001_initial.sql`                 | Cars, visits, schedules, the original reminder delivery table, owner-scoped row security, and the private photo bucket |                                            |                                                           |
| `0002_signup_photo_transfer.sql`   | Owner-scoped photo updates so interrupted signup transfers can retry safely                                            |                                            | [Guest data and signup](#guest-data-and-signup)           |
| `0003_vehicle_distance_units.sql`  | Per-vehicle distance unit with a Miles default; existing numeric values are preserved                                  |                                            | [Vehicles](vehicles.md#distance-units)                    |
| `0004_car_plate.sql`               | Empty-default, non-null `cars.plate` column with a 20-character constraint, without changing owner-scoped RLS          |                                            | [Vehicles](vehicles.md#license-plate)                     |
| `0005_vehicle_catalog.sql`         | Public make/model catalog tables; then run `supabase/seeds/vehicle-catalog.sql` as an administrator                    | `supabase/tests/vehicle_catalog.sql`       | [Vehicle catalog](vehicle-catalog.md#deployment)          |
| `0006_optional_visit_odometer.sql` | Optional visit odometer, preserving unknown readings without substituting zero                                         |                                            | [Maintenance schedules](maintenance-schedules.md)         |
| `0007_account_reminders.sql`       | Notification preferences, atomic weekly claims, and reworked delivery records                                          | `supabase/tests/account_reminders.sql`     | [Account reminders](account-reminders.md#deployment)      |
| `0008_schedule_defaults.sql`       | Persisted first due points for interval-only tasks, initialized from locked current records                            | `supabase/tests/schedule_defaults.sql`     | [Maintenance schedules](maintenance-schedules.md)         |
| `0009_atomic_schedule_saves.sql`   | Interval-only task saves and their baseline initialization in one transaction                                          | `supabase/tests/atomic_schedule_saves.sql` | [Maintenance schedules](maintenance-schedules.md)         |
| `0010_multi_currency.sql`          | Garage settings, receipt currencies and conversions, and the conditional background-save function                      | `supabase/tests/multi_currency.sql`        | [Multi-currency](multi-currency.md#reporting-and-rollout) |
| `0011_archive_vehicles.sql`        | Vehicle archive state and a `save_car` function that cannot undo a concurrent archive/restore                          | `supabase/tests/archive_vehicles.sql`      | [Vehicles](vehicles.md#archiving)                         |

Shipped migrations are never edited; schema changes go in a new numbered file.

## Environment variables

`.env.example` lists every deployment variable; Vercel supplies its system variables (`VERCEL_ENV`, `VERCEL_PROJECT_PRODUCTION_URL`, `VERCEL_GIT_COMMIT_SHA`) automatically, and the bug-report smoke test reads its own private tokens (see [bug reporting](bug-reporting.md#preview-smoke-test-and-rollout)). All deployment variables except the two `NEXT_PUBLIC_SUPABASE_*` values are server-only.

| Variables                                                                                   | Used by                                              |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`                          | Accounts and cloud sync                              |
| `SUPABASE_SECRET_KEY`, `REMINDERS_ENABLED`, `BREVO_*`, `CRON_SECRET`, `REMINDER_APP_ORIGIN` | [Account reminders](account-reminders.md#deployment) |
| `BUG_REPORTS_ENABLED`, `BUG_REPORT_*`, `UPSTASH_REDIS_REST_*`                               | [Bug reporting](bug-reporting.md#deployment-setup)   |

## Guest data and signup

Guests can use all garage features without signing in. **Create account** automatically transfers their records and photos after the new account authenticates. Transfers preserve record relationships and can resume after a reload or failed upload. Editing pauses during transfer or while awaiting retry; errors offer **Retry** or **Sign out**. Browser records and photos are only cleared after the cloud copy is verified. After a successful transfer, signing out opens a fresh guest garage. Edits made in another tab or after signing out during an interrupted transfer are retained locally.

Ordinary **Sign in** does not import or delete guest data; it opens the account's cloud garage. Signing out restores any guest records that have never been transferred. A pending signup transfer resumes only for the account that created it and the same Supabase project. Use the same browser and site origin for signup and transfer; guest data cannot be recovered from another browser or device. Authenticated cloud failures do not fall back to local writes. CSV export remains available from **Service history**.

## Search indexing

Search metadata uses Vercel's automatically supplied `VERCEL_PROJECT_PRODUCTION_URL` as its base URL. The homepage has a canonical link to that production domain and permits indexing only when `VERCEL_ENV=production` and the production URL is available. All other app pages use `noindex`, including vehicle records, history, reports, sign-in, signup, and account settings. Preview and local pages also use `noindex`. Local metadata falls back to `http://localhost:3000`; no additional environment variable is required on Vercel. Keep Vercel's **Automatically expose System Environment Variables** setting enabled. Canonical links are defined on the homepage rather than inherited by every route.

## Analytics and performance

Vercel Web Analytics is included in the root layout to track page views. Enable **Web Analytics** for the project in the Vercel dashboard, then deploy the app to start collecting data. No additional environment variables are required. See the [Vercel setup guide](https://vercel.com/docs/analytics/quickstart).

Vercel Speed Insights is also included in the root layout to measure performance across all routes. Enable **Speed Insights** for the project in the Vercel dashboard, then deploy the app and visit it to start collecting data. No additional environment variables are required. See the [Speed Insights setup guide](https://vercel.com/docs/speed-insights/quickstart).

## Free-tier limits

No paid plan or automatic upgrade is required. Free service quotas and Supabase inactivity pausing can delay an email or make the prototype temporarily unavailable. Check provider usage and export records regularly. The free photo bucket is limited to 1 GB; each visit accepts up to three resized photos of at most 2 MB each.
