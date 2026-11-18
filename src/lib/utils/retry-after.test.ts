// @vitest-environment node
import { expect, it } from 'vitest';
import { retryAfterDelay, retryAfterSeconds } from './retry-after';

it.each([null, '', 'invalid-date', '-5'])('ignores invalid or negative Retry-After %s', (value) =>
  expect(retryAfterDelay(value)).toBe(0),
);

it('accepts seconds and HTTP dates, ignoring dates already in the past', () => {
  const now = Date.UTC(2026, 9, 13, 12);
  expect(retryAfterDelay('120', now)).toBe(120000);
  expect(retryAfterDelay(new Date(now + 120000).toUTCString(), now)).toBe(120000);
  expect(retryAfterDelay(new Date(now - 120000).toUTCString(), now)).toBe(0);
});

it('rounds up to whole seconds and drops waits of zero or over a day', () => {
  const now = Date.UTC(2026, 9, 13, 12);
  expect(retryAfterSeconds('1.2', now)).toBe(2);
  expect(retryAfterSeconds(new Date(now + 90000).toUTCString(), now)).toBe(90);
  expect(retryAfterSeconds('86400', now)).toBe(86400);
  expect(retryAfterSeconds('86401', now)).toBeUndefined();
  expect(retryAfterSeconds('0', now)).toBeUndefined();
  expect(retryAfterSeconds(null, now)).toBeUndefined();
});
