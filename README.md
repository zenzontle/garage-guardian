# Garage Guardian

A private, responsive car maintenance tracker. Record multiple cars and service visits, set maintenance schedules from an owner's manual, see what is due, review spending, and export history to CSV.

Choose **Miles** (default) or **Kilometers** when adding a car. The distance unit is read-only in **Edit car**. Odometer readings, maintenance intervals, and service history use that vehicle’s chosen unit. Each car starts with a 30-day upcoming window and a distance window of **500 miles** or **1,000 kilometers**, adjustable in **Edit car**. Distance reminders use the latest entered odometer rather than an estimate. Existing vehicles remain Miles with their saved readings and reminder settings unchanged. CSV exports include a numeric Odometer column and a per-row Distance unit (`mi` or `km`).

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
4. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the project API settings in `.env.local` for local development, and in the hosting environment for deployment. Restart the app. Do not expose the service role key in a `NEXT_PUBLIC_` variable.
5. Deploy the Next.js app to a personal Vercel Hobby project. Add the two public Supabase variables there. The migration enables owner-scoped row security and a private photo bucket.

Set Supabase Auth's **Site URL** to your app URL and allow your deployed URL and `http://localhost:3000` as confirmation redirect URLs. The app supports email confirmation being enabled or disabled. If confirmation is required, users can continue locally until they confirm their email and authenticate in the browser containing their guest data.

| Configuration | Account | Application data |
| --- | --- | --- |
| No Supabase variables | No account required | Local prototype mode, browser IndexedDB |
| Supabase configured | Signed out | Guest mode, browser IndexedDB |
| Supabase configured | Signed in | Supabase database and private photo bucket |

Guests can use all garage features without signing in. **Create account** automatically transfers their records and photos after the new account authenticates. Transfers preserve record relationships and can resume after a reload or failed upload. Editing pauses during transfer or while awaiting retry; errors offer **Retry** or **Sign out**. Browser records and photos are only cleared after the cloud copy is verified. After a successful transfer, signing out opens a fresh guest garage. Edits made in another tab or after signing out during an interrupted transfer are retained locally.

Ordinary **Sign in** does not import or delete guest data; it opens the account's cloud garage. Signing out restores any guest records that have never been transferred. A pending signup transfer resumes only for the account that created it and the same Supabase project. Use the same browser and site origin for signup and transfer; guest data cannot be recovered from another browser or device. Authenticated cloud failures do not fall back to local writes. CSV export remains available from **Service history**.

## Web analytics

Vercel Web Analytics is included in the root layout to track page views. Enable **Web Analytics** for the project in the Vercel dashboard, then deploy the app to start collecting data. No additional environment variables are required. See the [Vercel setup guide](https://vercel.com/docs/analytics/quickstart).

## Optional free email digest

In-app due reminders always work. To try a weekly Monday email digest, configure a Brevo free account and a sender that can deliver mail without paid setup. Set `SUPABASE_SECRET_KEY`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `REMINDER_TO_EMAIL` (the account email), and a random `CRON_SECRET` on Vercel. Vercel invokes `/api/reminders` daily; the route sends at most one digest per Monday when tasks are upcoming or due. Test actual delivery before relying on it. If any variable is absent, email is disabled and the in-app due list remains available.

No paid plan or automatic upgrade is required. Free service quotas and Supabase inactivity pausing can delay an email or make the prototype temporarily unavailable. Check provider usage and export records regularly. The free photo bucket is limited to 1 GB; each visit accepts up to three resized photos of at most 2 MB each.

## Checks

```powershell
pnpm test
pnpm run typecheck
pnpm run build
```

The schedule is owner-entered. Starter tasks are names only; no interval is presented as an OEM recommendation. VIN lookup, automatic manufacturer schedules, spreadsheet import, and native apps are future work. Authenticated offline synchronization is not supported.

## License

MIT — see [LICENSE](LICENSE).
