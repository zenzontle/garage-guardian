# Garage Guardian

A private, responsive car maintenance tracker. Record multiple cars and service visits, set maintenance schedules from an owner's manual, see what is due, review spending, and export history to CSV.

Each car starts with a 30-day / 500-mile upcoming window, adjustable in **Edit car**. Mileage reminders use the latest entered odometer rather than an estimate.

## Run locally

```powershell
pnpm install
pnpm dev
```

Open `http://localhost:3000`. Without environment variables the app runs in **local prototype mode** and saves records and compressed photos in this browser's IndexedDB. This mode has no account or cross-device sync and is intended for trying the workflow.

## Enable private cloud sync

1. Create a free Supabase project. Run `supabase/migrations/0001_initial.sql` in its SQL editor, or apply it with the Supabase CLI.
2. In Supabase Auth, create your own email/password user and disable **Allow new users to sign up**. The app deliberately has no public registration screen.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the project API settings in `.env.local` for local development, and in the hosting environment for deployment. Restart the app. Do not expose the service role key in a `NEXT_PUBLIC_` variable.
4. Deploy the Next.js app to a personal Vercel Hobby project. Add the two public Supabase variables there. The migration enables owner-scoped row security and a private photo bucket.

With Supabase configured, the local browser data is not imported automatically. CSV export is available from **Service history** for a manual copy of service records; photos remain separate.

## Optional free email digest

In-app due reminders always work. To try a weekly Monday email digest, configure a Brevo free account and a sender that can deliver mail without paid setup. Set `SUPABASE_SECRET_KEY`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `REMINDER_TO_EMAIL` (the account email), and a random `CRON_SECRET` on Vercel. Vercel invokes `/api/reminders` daily; the route sends at most one digest per Monday when tasks are upcoming or due. Test actual delivery before relying on it. If any variable is absent, email is disabled and the in-app due list remains available.

No paid plan or automatic upgrade is required. Free service quotas and Supabase inactivity pausing can delay an email or make the prototype temporarily unavailable. Check provider usage and export records regularly. The free photo bucket is limited to 1 GB; each visit accepts up to three resized photos of at most 2 MB each.

## Checks

```powershell
pnpm test
pnpm run typecheck
pnpm run build
```

The schedule is owner-entered. Starter tasks are names only; no interval is presented as an OEM recommendation. VIN lookup, automatic manufacturer schedules, spreadsheet import, public signup, and native apps are future work.

## License

MIT — see [LICENSE](LICENSE).
