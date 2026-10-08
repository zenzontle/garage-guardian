import { describe, expect, it } from 'vitest';
import { accountPath, carPath, reportPath, reportPaths, validatedReturnTo } from './garage-routes';
import { contextSchema } from './bug-reports/shared';
import { report } from './bug-reports/fixtures.test-helper';

describe('garage URLs', () => {
  it.each(['/', '/cars', '/history', '/reports', '/cars/stable-id', '/cars/%C3%B1'])(
    'accepts workspace destination %s',
    (path) => {
      expect(validatedReturnTo(path)).toBe(path);
      expect(
        new URL(accountPath('signup', path), 'http://localhost').searchParams.get('returnTo'),
      ).toBe(path);
    },
  );
  it.each([
    null,
    '',
    'https://evil.test',
    '//evil.test',
    'javascript:alert(1)',
    '/signin',
    '/signup',
    '/cars/a/b',
    '/cars/..',
    '/cars/%2E%2E',
    '/cars/%2F%2Fevil.test',
    '/cars/%5Cevil',
    '/cars/%00',
    '/cars/a?secret=1',
    '/history#secret',
    '/cars/%3F',
    '/cars/%23',
    '/cars/%',
    '/cars/ id',
  ])('rejects unsafe or unknown destination %s', (path) => {
    expect(validatedReturnTo(path)).toBe('/');
  });
  it('encodes vehicle identifiers', () => {
    expect(carPath('café')).toBe('/cars/caf%C3%A9');
  });
  it.each(reportPaths)('allows report route template %s', (pathname) => {
    expect(contextSchema.safeParse({ ...report().context, pathname }).success).toBe(true);
  });
  it('redacts vehicle paths and rejects identifiers and URL parameters at the report boundary', () => {
    expect(reportPath('/cars/private-id')).toBe('/cars/[carId]');
    for (const pathname of ['/cars/private-id', '/history?secret=1', '/reports#secret', '/unknown'])
      expect(contextSchema.safeParse({ ...report().context, pathname }).success).toBe(false);
  });
});
