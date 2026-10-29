# Garage Guardian

A private, responsive car maintenance tracker. Record multiple cars and service visits, set maintenance schedules from an owner's manual, see what is due, review spending, and export history to CSV. VIN lookup, automatic manufacturer schedules, spreadsheet import, and native apps are future work.

## Features

- **Vehicles** in miles or kilometers, with optional license plates, archiving, and make/model suggestions. See [vehicles](docs/vehicles.md).
- **Maintenance schedules** driven by repeat intervals, with persisted first due points. See [maintenance schedules](docs/maintenance-schedules.md).
- **Receipts** in USD, MXN, or CAD, with home-currency reports and offline receipt retry. See [multi-currency](docs/multi-currency.md).
- **Guest mode and accounts**: use everything without signing in, then transfer to a private cloud account on signup. See [deployment](docs/deployment.md#guest-data-and-signup) and [account management](docs/account-management.md).
- **Weekly email reminders** (opt-in) alongside in-app due reminders. See [account reminders](docs/account-reminders.md).
- **English and Spanish** throughout. See [languages](docs/languages.md).
- **Protected forms**: forms protect unsaved work, uploads report their current stage, and saves/deletes provide accessible confirmations. See [interaction states](docs/interaction-states.md).
- **Bookmarkable screens** with keyboard and mobile-friendly navigation. See [navigation](docs/navigation.md).
- **Public feedback** (optional) to GitHub Issues. See [feedback](docs/feedback.md).

## Run locally

Use Node.js 22 and pnpm 12.6.0, pinned in `package.json`.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:3000`. Without environment variables the app runs in browser-only **local prototype mode**. To enable accounts and private cloud sync with Supabase and Vercel, follow [deployment](docs/deployment.md).

## Documentation

The [documentation index](docs/README.md) lists every setup, feature, and contributor guide. Start with [contributing](docs/contributing.md) for project layout and checks.

## License

MIT — see [LICENSE](LICENSE).
