# Vehicle catalog

The make/model catalog backs the optional [make and model suggestions](vehicles.md#make-and-model-suggestions). It is read-only for browser roles and refreshed manually.

## Data source

The initial catalog contains **145 makes and 1,560 models**, generated from the supplied [FuelEconomy.gov consolidated CSV](https://www.fueleconomy.gov/feg/download.shtml) (50,407 source records). The source covers US passenger cars and light trucks from 1984 onward; historical gaps, heavier vehicles, imports, and newly introduced models may be missing. See [field documentation](https://www.fueleconomy.gov/feg/ws/index.shtml). The import uses `baseModel` when nonempty and `model` otherwise, retaining meaningful punctuation and discarding years. It collapses whitespace, deduplicates normalized make/model pairs, and reports capitalization conflicts rather than inventing aliases.

The file was supplied/imported on **2026-10-03**; its original retrieval date is unknown. SHA-256: `b1ff0e3071c46cdc1c99e0015878b98a01851462d7e447237ce2fc1294ccf303`. Full provenance, counts, and the 11 reviewed capitalization conflicts are in `supabase/seeds/vehicle-catalog.provenance.json`. Output chooses the first display name in code-point order for conflicts. The original CSV is not bundled into the browser or committed.

## Refreshing the catalog

Refresh explicitly after downloading a new CSV (no runtime source dependency or scheduled refresh):

```powershell
node scripts/generate-vehicle-catalog.mjs C:/path/to/vehicles.csv supabase/seeds/vehicle-catalog.sql 2026-10-03 2026-10-03
```

Use the actual received/import and retrieval dates as the final two arguments; omit the last date if unknown. Review the SQL and provenance diff before applying. Malformed, empty, invalid-control-character, or overlength names reject the generation and leave the previous seed intact; details are written to the report. Repeated generation with the same input and dates is deterministic.

Apply the SQL through Supabase's administrative SQL editor or `psql` with `ON_ERROR_STOP=1`. Upserts preserve identifiers and prevent duplicates; refreshes add/update entries and do not delete historical entries. Browser roles (`anon`, `authenticated`) can only SELECT the catalog.

## Deployment

Deployment order: migration, seed, database permission check, then UI.

1. Apply `supabase/migrations/0005_vehicle_catalog.sql`.
2. Run `supabase/seeds/vehicle-catalog.sql` as an administrator.
3. Run `supabase/tests/vehicle_catalog.sql` in the SQL editor to verify public reads, blocked browser writes, and owner-scoped car access. The check rolls back its fixtures.
4. Deploy the UI.

Smoke-test add/edit in configured guest and authenticated environments and in an unconfigured prototype; check desktop/narrow-screen dropdown scrolling, touch selection, focus return, and screen-reader active-option announcements. Keyboard/ARIA behavior is covered by component tests; an actual screen-reader pass remains part of release verification.
