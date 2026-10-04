# Bug reporting verification

Checked on October 3, 2026. Reporting remains disabled by default. No Supabase migration or production credential changes were made.

## Local checks

- `pnpm test`: all 152 tests passed, including 42 reporting tests. Targeted reporting tests also passed after the final review fixes.
- `pnpm run typecheck` and `pnpm run build`: passed. The three reporting API routes compile as dynamic Node functions.
- Authentication tests cover missing, expired/spoofed, anonymous and verified sessions; HTTP tests cover account-scoped status reads and authoritative metadata.
- Diagnostic tests cover memory/age bounds, caught operations, console preservation and stacks, browser errors, rejections, object omission and best-effort redaction. Preview tests cover public acknowledgment, screen/dialog context, removal, account changes and preserved drafts.
- Multipart/image tests cover streaming without Content-Length, unknown/duplicate fields, payload and text limits, spoofed types, corruption, compressed images over the pixel cap and metadata removal.
- Shared-store tests use a Redis/limiter stand-in to check independent user/IP short and daily limits across instances, deployment isolation, atomic claims, SDK timeout refusal, Redis errors and Retry-After. Real Upstash integration is still a rollout check.
- Delivery tests cover concurrent duplicates, changed payloads, partial upload reuse, safe asset URLs, GitHub rate limits and ambiguous creation reconciliation without a second creation attempt.
- An acknowledgment mutation was deliberately introduced, detected by the tests, then restored.
- Headless Chrome checked the real reporter component and application styles at 1440px and 320px, with synthetic auth/config/delivery responses. Verified viewport bounds, image preview/removal, redaction, acknowledgment, submission, focus return and the launcher inside an existing dialog. No browser errors occurred. This component harness does not substitute for a live authenticated deployment or an audible screen-reader check.
- The production server returned disabled configuration and rejected submission/status requests with reporting off.

## Dependencies

The new direct dependencies are Upstash Redis/ratelimit and Zod (MIT), plus Sharp (Apache-2.0). Sharp was already transitive; it is now explicitly required for server image validation.

The production audit reports the same four existing PostCSS 8.4.31 advisories documented in `docs/zen-5-verification.md`, two high and two moderate. The new dependencies introduced no additional audit findings. These advisories concern attacker-controlled CSS/source maps; reporting accepts only decoded PNG/JPEG/WebP data and literal text, with no CSS processing path. Keep dependency remediation separate and review it by October 10, 2026; the audit is not clean.

## Pending live rollout checks

This workspace has no configured reporting PAT, Upstash credentials, test repository or Vercel preview deployment. Actual attachment permissions, GitHub rendering and shared Upstash behavior have therefore not been verified against those services.

Follow `docs/bug-reporting.md` and run `scripts/smoke-bug-reports.mjs` against a separate test repository in a configured Vercel Preview deployment. Check the resulting issue, real authenticated UI and provider failures before enabling production.
