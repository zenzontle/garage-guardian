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
        next: { revalidate: 86400 },
      });
    }
  },
);
it.each([
  'base=EUR&target=USD&date=2024-06-08',
  'base=USD&target=CAD&date=2024-02-30',
  'base=USD&target=CAD&date=2999-01-01',
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
    const response = await GET(request('base=MXN&target=USD&date=1900-01-01'));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: { code: 'rateUnavailable' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
