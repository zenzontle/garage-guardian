import { afterEach, expect, it, vi } from 'vitest';
import { GET } from './route';
import { CURRENCIES } from '@/lib/currency/currency';

afterEach(() => vi.unstubAllGlobals());
const request = (query: string) => new Request(`https://garage.test/api/exchange-rates?${query}`);
it.each(CURRENCIES.flatMap((base) => CURRENCIES.map((target) => [base, target] as const)))(
  'validates live-contract shape for %s/%s',
  async (base, target) => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ base, quote: target, date: '2024-06-07', rate: 1.25 }));
    vi.stubGlobal('fetch', fetcher);
    const response = await GET(request(`base=${base}&target=${target}&date=2024-06-08`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(
      base === target
        ? { rate: 1, rateDate: '2024-06-08' }
        : { rate: 1.25, rateDate: '2024-06-07' },
    );
    if (base === target) expect(fetcher).not.toHaveBeenCalled();
    else {
      expect(fetcher.mock.calls[0][0]).toBe(
        `https://api.frankfurter.dev/v2/providers/ecb/rate/${base}/${target}?date=2024-06-08`,
      );
      expect(fetcher.mock.calls[0][1]).toMatchObject({
        redirect: 'error',
        next: { revalidate: 2592000 },
      });
    }
  },
);
it.each([
  'base=EUR&target=USD&date=2024-06-08',
  'base=USD&target=CAD&date=2024-02-30',
  'base=USD&target=CAD&date=2999-01-01',
  'base=USD&target=CAD&date=1999-01-03',
  'base=MXN&target=USD&date=1900-01-01',
  'base=USD&target=CAD&date=2024-06-08&amount=20',
  'base=USD&base=MXN&target=CAD&date=2024-06-08',
])('rejects invalid or extra inputs: %s', async (query) => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  expect((await GET(request(query))).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  { rate: -1 },
  { rate: '1.2' },
  { date: '2024-06-10' },
  { date: '2024-02-30' },
  { quote: 'MXN' },
  { base: 'CAD' },
])('rejects malformed provider data %j', async (patch) => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ base: 'USD', quote: 'CAD', date: '2024-06-07', rate: 1.25, ...patch }),
      ),
  );
  expect((await GET(request('base=USD&target=CAD&date=2024-06-08'))).status).toBe(503);
});
it.each(['missing', 'offline', 'timeout'])(
  'exposes %s failure without substituting a current rate',
  async (failure) => {
    const fetcher = vi.fn();
    if (failure === 'missing') fetcher.mockResolvedValue(new Response(null, { status: 404 }));
    else fetcher.mockRejectedValue(new Error(failure));
    vi.stubGlobal('fetch', fetcher);
    const response = await GET(request('base=MXN&target=USD&date=1999-01-04'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'rateUnavailable' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
it('accepts a local today that is already tomorrow in UTC', async () => {
  vi.useFakeTimers({ now: new Date('2024-06-08T20:00:00Z') });
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json({ base: 'USD', quote: 'CAD', date: '2024-06-07', rate: 1.25 }),
    );
  vi.stubGlobal('fetch', fetcher);
  try {
    const response = await GET(request('base=USD&target=CAD&date=2024-06-09'));
    expect(response.status).toBe(200);
    expect(fetcher.mock.calls[0][0]).toContain('?date=2024-06-08');
    // Today's rate may still be unpublished, so it is not cached for a full day.
    expect(fetcher.mock.calls[0][1]).toMatchObject({ next: { revalidate: 3600 } });
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
    expect((await GET(request('base=USD&target=CAD&date=2024-06-10'))).status).toBe(400);
  } finally {
    vi.useRealTimers();
  }
});
it.each([
  { date: '2024-06-12', revalidate: 3600 },
  { date: '2024-06-11', revalidate: 86400 },
  { date: '2024-06-05', revalidate: 86400 },
  { date: '2024-06-04', revalidate: 2592000 },
  { date: '1999-01-04', revalidate: 2592000 },
])('caches the $date rate for $revalidate seconds', async ({ date, revalidate }) => {
  vi.useFakeTimers({ now: new Date('2024-06-12T12:00:00Z') });
  const fetcher = vi
    .fn()
    .mockResolvedValue(Response.json({ base: 'USD', quote: 'CAD', date, rate: 1.25 }));
  vi.stubGlobal('fetch', fetcher);
  try {
    const response = await GET(request(`base=USD&target=CAD&date=${date}`));
    expect(response.status).toBe(200);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ next: { revalidate } });
    expect(response.headers.get('Cache-Control')).toBe(`public, max-age=${revalidate}`);
  } finally {
    vi.useRealTimers();
  }
});
it('keeps same-currency receipts before ECB data at a rate of 1', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const response = await GET(request('base=USD&target=USD&date=1995-03-01'));
  expect(await response.json()).toEqual({ rate: 1, rateDate: '1995-03-01' });
  expect(fetcher).not.toHaveBeenCalled();
});
