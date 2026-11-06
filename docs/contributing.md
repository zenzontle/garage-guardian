# Contributing

## Project organization

Files are grouped by responsibility. Components and library modules use feature folders, with tests beside the files they cover and shared test support in `src/test`.

| Folder              | Contents                                                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app`           | Next.js route pages, layouts, API handlers, and app icon                                                                                                             |
| `src/components`    | Feature folders for account, feedback, dashboard, fuel, garage shell, history, localization, interactions, maintenance, notifications, reports, vehicles, and visits |
| `src/components/ui` | Shared controls, dialogs, input helpers, and feedback components                                                                                                     |
| `src/lib`           | Feature folders for account, feedback, fuel, garage data, maintenance, navigation, notifications, reminders, reports, and vehicle catalog logic                      |
| `src/lib/utils`     | Shared error, date, and photo preparation helpers                                                                                                                    |
| `src/i18n`          | Locale configuration, context, and display formatting                                                                                                                |
| `src/styles`        | Global, localization, and usability styles                                                                                                                           |
| `src/test`          | Shared fixtures, fake services, routing helpers, and test setup                                                                                                      |
| `messages`          | English and Spanish translation dictionaries                                                                                                                         |
| `public`            | Public static assets                                                                                                                                                 |
| `scripts`           | Maintenance and smoke-test scripts with their tests                                                                                                                  |
| `e2e`               | Playwright browser tests, their helpers, and fixtures                                                                                                                |
| `supabase`          | Database migrations, seeds, and SQL verification scripts                                                                                                             |
| `docs`              | Setup, feature, and contributor guides                                                                                                                               |

Each UI component has its own kebab-case file within its feature folder. `GarageApp` supplies persistent locale and garage providers through the shared route layout. `GarageProvider` owns the session and transient UI state, `GarageContent` renders the shell and dialogs, and route screen components connect page components to shared data and actions. Pages, account forms, car/task/visit dialogs, navigation controls, and feedback sections import shared UI components directly from their files. The locale provider and selector in `src/components/i18n` share `src/i18n/locale-context.ts`; date and photo preparation helpers live in `src/lib/utils`.

User-facing text belongs in the translation dictionaries; see [languages](languages.md#translations).

## Checks

```powershell
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm e2e
```

CI runs `pnpm exec prettier --check .` and `pnpm exec eslint . --max-warnings 0` (warnings fail), then typecheck, test, and build. A separate browser-test job builds the app and runs `pnpm e2e`, uploading the Playwright report and traces when a test fails.

Browser tests in `e2e` run the production build in local prototype mode, in Chromium at a desktop size and a phone size (Pixel 7). They cover vehicles, maintenance reminders, service visits with photos, history filters and CSV export, fuel economy, reports, unsaved-change prompts, language switching, and navigation. Run `pnpm exec playwright install chromium` once, then `pnpm build` before `pnpm e2e`; the tests start the built app on port 3210, which must be free. They run without retries, so a flaky test fails. Build without Supabase variables (move `.env.local` aside), or the app will not run in prototype mode. Each test opens a fresh browser context, so IndexedDB starts empty.

ESLint checks JavaScript, TypeScript, and TSX files with the recommended Next.js Core Web Vitals and TypeScript rules. Run `pnpm lint` to check the project or `pnpm lint:fix` to apply automatic fixes. Configuration lives in `eslint.config.mjs`; generated Next.js types, build output, and coverage are excluded. Prettier handles formatting separately, with `eslint-config-prettier` preventing conflicting lint rules.

Prettier is installed locally with a pinned version. Run `pnpm format` to format supported project files, or `pnpm format:check` to check formatting without changing files. The configuration uses single quotes, semicolons, trailing commas, two-space indentation, a 100-character print width, and LF line endings enforced by `.gitattributes`. Generated files and build output are excluded through `.prettierignore`; Prettier also respects `.gitignore`. To format only files changed during a task, run `pnpm exec prettier --write path/to/file.ts` with the relevant file paths.

Automated tests use fakes, stand-ins, or mocked HTTP for Supabase, Brevo, GitHub, Upstash, and the exchange-rate provider; they never send real email or publish real issues. Browser tests use no cloud services. Live provider behavior is checked by the staging and smoke tests described in each feature guide.

## Pull requests

[`REVIEW.md`](../REVIEW.md) defines what reviewers flag. Paths listed in `.github/CODEOWNERS` (`.github/`, `REVIEW.md`, `supabase/`, `src/app/api/`, `vercel.json`, account code, and dependency files) always need a human review. Dependency changes also follow [dependency security](dependency-security.md).
