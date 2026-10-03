# ZEN-5 verification — 2026-10-03

The change adds optional make/model suggestions to the shared car modal. No catalog years or car foreign keys are introduced. No application dependencies changed.

## Automated checks

- `pnpm test`: 79 tests covering the existing application plus import fixtures, pagination/caching/retry, exact make scoping, obsolete responses, editable-combobox interactions, prototype bypass, and guest/authenticated save/reload. The outage test saves a car while catalog reads are failing, then retries in Edit car.
- `pnpm run typecheck` and `pnpm run build`: pass.
- The supplied full CSV regenerates SQL and provenance byte-for-byte. Counts: 145 makes, 1,560 models, 50,407 source records, zero rejected names, 11 reviewed capitalization conflicts.

## Database verification

Ran all five repository migrations, the generated seed twice, and `supabase/tests/vehicle_catalog.sql` in an isolated PGlite PostgreSQL engine. Minimal `auth`/`storage` schema stand-ins supported the existing migrations; Supabase-style default table grants were present before catalog migration 0005. Verified stable make IDs and unchanged counts after reseeding, RLS enabled on both catalog tables, complete anonymous/authenticated reads, no browser write grants, rejected catalog write attempts, anonymous car isolation, owner-only car reads/updates, and free-text car updates. The SQL verification fixtures roll back.

This validates SQL behavior locally. The actual target Supabase project must apply catalog migration 0005 and the seed, then run the SQL check before UI deployment. No live Supabase configuration or hosting target was provided in this worktree.

## Browser verification

Used headless Chrome with the real Next.js application and the complete generated catalog behind a simulated Supabase REST endpoint capped at 75 rows per response:

- Configured guest Add/Edit/Reload at 1440, 768, and 320 pixels; 1024-pixel accessibility/focus check.
- Desktop pointer and mobile touch selection; model scoping after make changes; retained model text; unknown values; save/reload persistence.
- Dropdown bounds and scrolling, Arrow keys, Enter selection without submission, Escape dismissing the list before the modal, Tab trapping, and focus return.
- Browser accessibility snapshot exposes the named combobox, named listbox, and selected active option. No page errors observed.
- Production-build prototype Add/Edit/Reload uses plain Make/Model inputs and makes zero catalog requests.

Authenticated persistence is covered by Testing Library integration tests using the existing owner-scoped fake Supabase backend. Live authenticated smoke testing and audible screen-reader announcements remain release checks; ARIA assertions do not substitute for an actual screen reader.

## Existing dependency audit findings

`pnpm audit --prod` reports four advisories in the existing Next.js dependency on PostCSS 8.4.31: two high and two moderate ([GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q), [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849), [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93), [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp)). These concern processing attacker-controlled CSS/source maps. This feature adds no dependencies and passes vehicle names only as escaped React text, with no path into CSS processing. Dependency remediation is separate from ZEN-5; the audit itself is not clean.
