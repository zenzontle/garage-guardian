# Receipt currencies and home-currency reports

Receipts use USD, MXN, or CAD. Original integer cents and all receipt line items share the receipt currency. Account settings select the reporting currency independently of language, distance units, and location. Guest settings live in IndexedDB; authenticated settings use owner-scoped `garage_settings`. Missing legacy preferences and receipt currencies normalize to USD without changing amounts.

## Conversions

`Visit.conversions` maps target currency codes to immutable saved conversions. Each includes the original currency, date and total as an input fingerprint, converted cents, `automatic` or `manual` source, and a nullable rate and effective date. Missing entries mean pending. Same-currency reporting reads original cents without a lookup.

`GET /api/exchange-rates?base=USD&target=MXN&date=2024-06-08` accepts only the supported codes and a real nonfuture ISO date. Extra and duplicate parameters are rejected. Success returns `{ rate, rateDate }`; invalid input returns 400 and unavailable or malformed upstream data returns 503. Only the pair and date go to the fixed Frankfurter ECB endpoint. The upstream timeout is five seconds; the client timeout is seven seconds. Successful lookups cache by pair and requested date; failures remain retryable. No current-rate fallback is permitted.

The live contract was checked on October 21, 2026: `/v2/providers/ecb/rate/USD/MXN?date=2024-06-08` returned `{ "date": "2024-06-07", "base": "USD", "quote": "MXN", "rate": 17.888 }`. Frankfurter's general v2 endpoint returned blended weekend observations, so the application explicitly selects ECB publications to expose their effective date. See [Frankfurter documentation](https://frankfurter.dev/).

Automatic conversions are estimates. Actual card charges use manual conversions without an implied exchange rate. Money uses integer cents with decimal half-up conversion rounding. Category allocation uses largest remainders with receipt line order as the tie breaker, followed by the unallocated remainder. Allocations reconcile exactly to the saved converted total, including zero-cost receipts with a manually entered charge.

Changing date, original total, or currency invalidates conversion fingerprints. Other edits preserve stored conversions. `Repository.saveVisit(visit, manualTargets)` accepts explicit manual edits only for the listed targets; copied manual values from an older form cannot replace newer overrides. Signup transfer explicitly imports its frozen manual targets and verifies the home currency and conversions before deleting guest records.

Background persistence uses an IndexedDB transaction locally and one conditional, owner-scoped PostgreSQL UPDATE in the cloud. Both recheck original inputs and require an absent target conversion. Existing automatic values and manual overrides win over delayed lookups. Home-currency changes preserve all saved targets and fetch only missing conversions. Successful background writes reconcile the displayed snapshot even if their initiating effect has been replaced.

## Offline account receipts

After an authenticated garage has loaded online, receipts can be saved on that device during connectivity failures. An account/project-scoped IndexedDB cache and outbox retain those receipts across reloads. A visible sync count offers retry; reconnecting also retries. Authentication, authorization, and database validation errors are not reported as successful offline saves. New cloud photo uploads still require connectivity, as do the existing vehicle and schedule mutations.

Receipt flushes, edits, deletes, and background conversions share an account-scoped operation lock, using Web Locks across tabs where available. Queued manual intent is merged into subsequent unrelated edits. Signup transfer uses an online-only repository so a cached record cannot falsely satisfy cloud verification. IndexedDB storage must remain available for device-only work; clearing site data removes unsynced receipts.

If an outbox receipt's vehicle was deleted on another device, its foreign-key conflict does not block loading fresh garage data or syncing other receipts. The receipt and its saved conversions remain on the device. A conflict notice links to service history, where receipts for deleted vehicles appear under “Unknown car” and can be discarded using the existing delete action. Connectivity failures still use the cached garage, and authorization failures remain errors.

## Reporting and rollout

Dashboard spending, report totals, charts, category breakdowns, averages, and cost sorting use home-currency amounts. Pending conversions are excluded, visibly counted, and sorted last in both cost directions. History and receipt details retain original amounts and explicit currency codes. CSV headers stay in English and include original currency/amounts, reporting currency, converted total, source, and rate date; unavailable conversions are blank.

Apply `supabase/migrations/0010_multi_currency.sql` **before** deploying application code. It adds garage settings with owner RLS, receipt currency and conversion constraints, preservation/invalidation triggers, and the conditional background-save function. No API key or paid rate service is required. No application deployment or connected database migration is performed by the implementation task.

Run `supabase/tests/multi_currency.sql` as an administrator after migration; its fixtures roll back. Automated tests also cover currency pairs, legacy defaults, manual overrides, stale responses, offline save/retry, signup resume, sorting, category reconciliation, CSV, incomplete indicators, bilingual forms, keyboard access and unsaved-change protection. Migration compilation and its SQL regression script were verified in a disposable PostgreSQL 17 database with the relevant auth/RLS scaffolding.

The production dependency audit on October 21, 2026 reported three high and four moderate advisories in the existing dependency graph. The high findings concern PostCSS/source-map processing through Next.js: [CSS source-map file reads](https://github.com/advisories/GHSA-6g55-p6wh-862q), [source-map path traversal](https://github.com/advisories/GHSA-r28c-9q8g-f849), and [indexed source-map denial of service](https://github.com/advisories/GHSA-68fv-2mgg-jv7q). This feature adds no dependencies and processes no user CSS or source maps. The affected packages remain reachable during builds of repository-controlled CSS; dependency remediation is deferred to a separate update, with review due October 28, 2026. Do not interpret the passing application checks as a clean dependency audit.
