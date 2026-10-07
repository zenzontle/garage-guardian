# Garage Guardian

A private, responsive car maintenance tracker. Record multiple cars and service visits, set maintenance schedules from an owner's manual, see what is due, review spending, and export history to CSV.

Choose **Miles** (default) or **Kilometers** when adding a car. The distance unit is read-only in **Edit car**. Odometer readings, maintenance intervals, and service history use that vehicle’s chosen unit. Each car starts with a 30-day upcoming window and a distance window of **500 miles** or **1,000 kilometers**, adjustable in **Edit car**. Distance reminders use the latest entered odometer rather than an estimate. Existing vehicles remain Miles with their saved readings and reminder settings unchanged. CSV exports include a numeric Odometer column and a per-row Distance unit (`mi` or `km`).

Each car can have an optional **License plate**, shown in its detail header when present. Add, edit, or clear it alongside VIN. Plates are free text up to **20 characters** after trimming leading and trailing whitespace; case, internal spaces, and punctuation are preserved. Blank input means no plate. No country-specific format, uniqueness rule, registration jurisdiction, or plate lookup is used. Older records load with no plate, and signup transfers preserve saved plates, including interrupted transfers resumed after a reload.

## Languages

Use the **English / Español** selector in the header, account screens, or open dialogs. The first render is English on both server and client. After mounting, the app uses a valid saved choice, otherwise the first supported browser language (including regional variants such as `es-MX`), with English fallback. Explicit choices are stored under `garage-guardian:locale` in local storage, independently of accounts and garage data, and survive reload, sign-in, and sign-out. If storage is unavailable, switching still works for the current session. The document's `lang` follows the resolved language. Switching updates provider values without remounting forms or restarting transfers.

Neutral Spanish uses `es` number/date formatting. Currency stays **USD**, each vehicle keeps its **mi/km** unit, and form values remain canonical numbers, integer cents, and ISO dates. Date-only displays use UTC explicitly so the calendar day never shifts. Stored names, notes, categories, and other user-entered text are never translated or renamed. New starter tasks use the language selected when the car is saved. CSV headers, values, fallback labels, units, and escaping remain canonical English regardless of the export button's language. No database migration is needed. Provider-owned confirmation emails and the optional server email digest remain in their provider/server language.

Translations live in `messages/en.json` and `messages/es.json`, grouped by feature and shared controls. Use `next-intl`'s `useTranslations` with typed keys and complete ICU sentences for interpolation/plurals; use `useDisplay` (backed by `useFormatter`) for display values, and keep calculations and storage independent of locale. Spanish messages recursively override English defaults; `next-intl`'s development diagnostics remain enabled for missing or malformed messages. Errors use stable `AppFailure` codes and values and are translated at render time, including errors already visible when language changes. Unknown provider details are replaced with actionable localized fallback copy.

When adding another language, add a complete dictionary with the same nested keys and ICU placeholders, extend `Locale` and `isLocale` in `src/i18n/config.ts`, merge it over English defaults, add its selector option, and extend dictionary parity, pluralization, locale resolution, and workflow tests. Review terminology and text expansion in desktop/mobile dialogs and tables. The configuration follows the [next-intl client provider documentation](https://next-intl.dev/docs/usage/configuration#nextintlclientprovider); this browser-local release needs no locale routes or server request configuration.

## Run locally

```powershell
pnpm install
pnpm dev
```

Open `http://localhost:3000`. Without environment variables the app runs in **local prototype mode** and saves records and compressed photos in this browser's IndexedDB. This mode has no account or cross-device sync and is intended for trying the workflow.

## Enable private cloud sync

1. Create a free Supabase project. Run `supabase/migrations/0001_initial.sql` in its SQL editor, or apply it with the Supabase CLI.
2. Apply `supabase/migrations/0002_signup_photo_transfer.sql` as well. It permits owner-scoped photo updates so interrupted signup transfers can retry safely. In Supabase Auth, enable email/password authentication and **Allow new users to sign up**.
3. Apply `supabase/migrations/0003_vehicle_distance_units.sql` before deploying the distance-unit update. It adds the unit with a Miles default; existing numeric values are preserved. All distance fields (including legacy `*_miles` columns) use the parent vehicle’s unit. The app writes the 500-mile or 1,000-kilometer reminder default explicitly.
4. Apply `supabase/migrations/0004_car_plate.sql` **before deploying this plate update**. It adds an empty-default, non-null `cars.plate` column and a 20-character database constraint without changing owner-scoped RLS. Existing cars receive an empty plate. Deploy application writes only after this migration succeeds.
5. Apply `supabase/migrations/0005_vehicle_catalog.sql`, then run `supabase/seeds/vehicle-catalog.sql` as an administrator before deploying autocomplete. Run `supabase/tests/vehicle_catalog.sql` in the SQL editor to verify public reads, blocked browser writes, and owner-scoped car access. The check rolls back its fixtures.
6. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the project API settings in `.env.local` for local development, and in the hosting environment for deployment. Restart the app. Do not expose the service role key in a `NEXT_PUBLIC_` variable.
7. Deploy the Next.js app to a personal Vercel Hobby project. Add the two public Supabase variables there. The migration enables owner-scoped row security and a private photo bucket.

Set Supabase Auth's **Site URL** to your app URL and allow your deployed URL and `http://localhost:3000` as confirmation redirect URLs. The app supports email confirmation being enabled or disabled. If confirmation is required, users can continue locally until they confirm their email and authenticate in the browser containing their guest data.

| Configuration         | Account             | Application data                           |
| --------------------- | ------------------- | ------------------------------------------ |
| No Supabase variables | No account required | Local prototype mode, browser IndexedDB    |
| Supabase configured   | Signed out          | Guest mode, browser IndexedDB              |
| Supabase configured   | Signed in           | Supabase database and private photo bucket |

Guests can use all garage features without signing in. **Create account** automatically transfers their records and photos after the new account authenticates. Transfers preserve record relationships and can resume after a reload or failed upload. Editing pauses during transfer or while awaiting retry; errors offer **Retry** or **Sign out**. Browser records and photos are only cleared after the cloud copy is verified. After a successful transfer, signing out opens a fresh guest garage. Edits made in another tab or after signing out during an interrupted transfer are retained locally.

Ordinary **Sign in** does not import or delete guest data; it opens the account's cloud garage. Signing out restores any guest records that have never been transferred. A pending signup transfer resumes only for the account that created it and the same Supabase project. Use the same browser and site origin for signup and transfer; guest data cannot be recovered from another browser or device. Authenticated cloud failures do not fall back to local writes. CSV export remains available from **Service history**.

## Optional make/model suggestions

**Add a car** and **Edit car** offer editable Make and Model suggestions whenever Supabase is configured, including signed-out guests. Prototype mode keeps plain inputs and performs zero catalog requests. Makes load when the modal opens; models load only for the exact make after trimming, collapsing whitespace, and ignoring case. Year does not filter suggestions. Changing make preserves the typed model. Lists are paginated and cached in memory per project and make; typing filters locally. Failed reads offer a retry and never block car entry or saving.

Up to ten suggestions appear, ordered by exact match, prefix, then substring, alphabetically within each group. Use Arrow Up/Down and Enter to choose, Escape to dismiss, or tap/click an option. Tab and blur preserve free text. Suggestions are optional: unknown names and arbitrary make/model pairs are accepted, with the existing required/50-character fields and trim-on-save behavior. There is no VIN lookup or vehicle verification, and cars have no catalog foreign keys.

The initial catalog contains **145 makes and 1,560 models**, generated from the supplied [FuelEconomy.gov consolidated CSV](https://www.fueleconomy.gov/feg/download.shtml) (50,407 source records). The source covers US passenger cars and light trucks from 1984 onward; historical gaps, heavier vehicles, imports, and newly introduced models may be missing. See [field documentation](https://www.fueleconomy.gov/feg/ws/index.shtml). The import uses `baseModel` when nonempty and `model` otherwise, retaining meaningful punctuation and discarding years. It collapses whitespace, deduplicates normalized make/model pairs, and reports capitalization conflicts rather than inventing aliases.

The file was supplied/imported on **2026-10-03**; its original retrieval date is unknown. SHA-256: `b1ff0e3071c46cdc1c99e0015878b98a01851462d7e447237ce2fc1294ccf303`. Full provenance, counts, and the 11 reviewed capitalization conflicts are in `supabase/seeds/vehicle-catalog.provenance.json`. Output chooses the first display name in code-point order for conflicts. The original CSV is not bundled into the browser or committed.

Refresh explicitly after downloading a new CSV (no runtime source dependency or scheduled refresh):

```powershell
node scripts/generate-vehicle-catalog.mjs C:/path/to/vehicles.csv supabase/seeds/vehicle-catalog.sql 2026-10-03 2026-10-03
```

Use the actual received/import and retrieval dates as the final two arguments; omit the last date if unknown. Review the SQL and provenance diff before applying. Malformed, empty, invalid-control-character, or overlength names reject the generation and leave the previous seed intact; details are written to the report. Repeated generation with the same input and dates is deterministic. Apply the SQL through Supabase's administrative SQL editor or `psql` with `ON_ERROR_STOP=1`. Upserts preserve identifiers and prevent duplicates; refreshes add/update entries and do not delete historical entries. Browser roles (`anon`, `authenticated`) can only SELECT the catalog.

Deployment order: migration, seed, database permission check, then UI. Smoke-test add/edit in configured guest and authenticated environments and in an unconfigured prototype; check desktop/narrow-screen dropdown scrolling, touch selection, focus return, and screen-reader active-option announcements. Keyboard/ARIA behavior is covered by component tests; an actual screen-reader pass remains part of release verification.

## Optional public bug reporting

Enable an authenticated **Report a bug** button per deployment with `BUG_REPORTS_ENABLED=true`. Users review their description, diagnostic context, recent errors, and optional screenshots before acknowledging that the report will be public and publishing it to GitHub Issues. Guests cannot submit. Upstash Redis provides shared user/IP limits and retry receipts; no Supabase migration is needed.

See [bug reporting setup and verification](docs/bug-reporting.md) and `.env.example` for server-only credentials, validation limits, public-data handling, and the synthetic preview smoke test. Reporting defaults to disabled; keep production disabled until the preview smoke test passes.

## Web analytics

Vercel Web Analytics is included in the root layout to track page views. Enable **Web Analytics** for the project in the Vercel dashboard, then deploy the app to start collecting data. No additional environment variables are required. See the [Vercel setup guide](https://vercel.com/docs/analytics/quickstart).

## Optional free email digest

In-app due reminders always work. To try a weekly Monday email digest, configure a Brevo free account and a sender that can deliver mail without paid setup. Set `SUPABASE_SECRET_KEY`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `REMINDER_TO_EMAIL` (the account email), and a random `CRON_SECRET` on Vercel. Vercel invokes `/api/reminders` daily; the route sends at most one digest per Monday when tasks are upcoming or due. Test actual delivery before relying on it. If any variable is absent, email is disabled and the in-app due list remains available.

No paid plan or automatic upgrade is required. Free service quotas and Supabase inactivity pausing can delay an email or make the prototype temporarily unavailable. Check provider usage and export records regularly. The free photo bucket is limited to 1 GB; each visit accepts up to three resized photos of at most 2 MB each.

## Component organization

UI components live in `src/components`, with each component in its own kebab-case file.
`GarageApp` supplies the locale provider, while `GarageContent` coordinates the garage
session, navigation, and dialogs. Pages, account forms, car/task/visit dialogs, navigation
controls, and bug-report sections import shared UI components directly from their files.
The locale provider and selector share `src/i18n/locale-context.ts`; date and photo
preparation helpers live in `src/lib`.

## Checks

Prettier is installed locally with a pinned version. Run `pnpm format` to format supported
project files, or `pnpm format:check` to check formatting without changing files. The
configuration uses single quotes, semicolons, trailing commas, two-space indentation,
a 100-character print width, and LF line endings enforced by `.gitattributes`. Generated files and build output are
excluded through `.prettierignore`; Prettier also respects `.gitignore`.

To format only files changed during a task, run `pnpm exec prettier --write path/to/file.ts`
with the relevant file paths.

```powershell
pnpm test
pnpm run typecheck
pnpm run build
```

The schedule is owner-entered. Starter tasks are names only; no interval is presented as an OEM recommendation. VIN lookup, automatic manufacturer schedules, spreadsheet import, and native apps are future work. Authenticated offline synchronization is not supported.

## License

MIT — see [LICENSE](LICENSE).
