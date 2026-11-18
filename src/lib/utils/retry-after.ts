/**
 * Milliseconds to wait from a `Retry-After` header, which holds either seconds or an HTTP
 * date. Returns 0 for a missing, invalid, negative or past value.
 */
export function retryAfterDelay(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const delay = Number.isFinite(Number(value)) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
}

/** Whole seconds to wait from a `Retry-After` header, or undefined if none or over a day. */
export function retryAfterSeconds(value: string | null, now = Date.now()): number | undefined {
  const seconds = Math.ceil(retryAfterDelay(value, now) / 1000);
  return seconds > 0 && seconds <= 86400 ? seconds : undefined;
}
