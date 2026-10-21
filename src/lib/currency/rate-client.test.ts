import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());
it('deduplicates pair/date lookups, caches successes, and retries failures', async () => {
  vi.resetModules();
  const { lookupRate } = await import('./rate-client');
  const fetcher = vi
    .fn()
    .mockImplementation(async () => Response.json({ rate: 1.25, rateDate: '2024-06-07' }));
  vi.stubGlobal('fetch', fetcher);
  const results = await Promise.all([
    lookupRate('USD', 'CAD', '2024-06-08'),
    lookupRate('USD', 'CAD', '2024-06-08'),
  ]);
  expect(results[0]).toEqual(results[1]);
  await lookupRate('USD', 'CAD', '2024-06-08');
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toBe('/api/exchange-rates?base=USD&target=CAD&date=2024-06-08');
  fetcher.mockRejectedValueOnce(new Error('offline'));
  await expect(lookupRate('USD', 'MXN', '2024-06-08')).rejects.toThrow('offline');
  await lookupRate('USD', 'MXN', '2024-06-08');
  await lookupRate('USD', 'CAD', '2024-06-09');
  expect(fetcher).toHaveBeenCalledTimes(4);
});
