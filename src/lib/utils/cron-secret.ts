import { timingSafeEqual } from 'node:crypto';

/** Constant-time check of a cron route's `Authorization: Bearer <CRON_SECRET>` header. */
export function cronAuthorized(header: string | null, secret: string | undefined) {
  if (!secret || header === null) return false;
  const actual = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
