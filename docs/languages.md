# Languages

## Choosing a language

Use the **English / Español** selector in the header, account screens, or open dialogs. The **Send feedback** dialog has no selector; choose the language before opening it. The first render is English on both server and client. After mounting, the app uses a valid saved choice, otherwise the first supported browser language (including regional variants such as `es-MX`), with English fallback. Explicit choices are stored under `garage-guardian:locale` in local storage, independently of accounts and garage data, and survive reload, sign-in, and sign-out. If storage is unavailable, switching still works for the current session. The document's `lang` follows the resolved language. Switching updates provider values without remounting forms or restarting transfers.

## What is and isn't translated

Neutral Spanish uses `es` number/date formatting. Each vehicle keeps its **mi/km** unit, and form values remain canonical numbers, integer cents, and ISO dates. Receipt and reporting currencies are independent of language; see [multi-currency](multi-currency.md). Date-only displays use UTC explicitly so the calendar day never shifts. Stored names, notes, categories, and other user-entered text are never translated or renamed. New starter tasks use the language selected when the car is saved. CSV headers, values, fallback labels, units, and escaping remain canonical English regardless of the export button's language.

Provider-owned confirmation emails remain in their provider language. Weekly reminder emails have a separate English/Spanish preference saved to each account; see [account reminders](account-reminders.md).

## Translations

Translations live in `messages/en.json` and `messages/es.json`, grouped by feature and shared controls. Use `next-intl`'s `useTranslations` with typed keys and complete ICU sentences for interpolation/plurals; use `useDisplay` (backed by `useFormatter`) for display values, and keep calculations and storage independent of locale. Spanish messages recursively override English defaults; `next-intl`'s development diagnostics remain enabled for missing or malformed messages. Errors use stable `AppFailure` codes and values and are translated at render time, including errors already visible when language changes. Unknown provider details are replaced with actionable localized fallback copy.

## Adding a language

Add a complete dictionary with the same nested keys and ICU placeholders, extend `Locale` and `isLocale` in `src/i18n/config.ts`, merge it over English defaults, add its selector option, and extend dictionary parity, pluralization, locale resolution, and workflow tests. Review terminology and text expansion in desktop/mobile dialogs and tables. The configuration follows the [next-intl client provider documentation](https://next-intl.dev/docs/usage/configuration#nextintlclientprovider); this browser-local release needs no locale routes or server request configuration.
