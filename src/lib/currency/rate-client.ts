import { isCurrency, validDate, type Currency, type Rate } from './currency';

const cache = new Map<string, Rate>();
const inFlight = new Map<string, Promise<Rate>>();
export function lookupRate(base: Currency, target: Currency, date: string): Promise<Rate> {
  if (!isCurrency(base) || !isCurrency(target) || !validDate(date))
    return Promise.reject(new Error('Invalid rate request'));
  if (base === target) return Promise.resolve({ rate: 1, rateDate: date });
  const key = `${base}/${target}/${date}`;
  const saved = cache.get(key);
  if (saved) return Promise.resolve(saved);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const work = (async () => {
    const response = await fetch(`/api/exchange-rates?base=${base}&target=${target}&date=${date}`, {
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error('Rate unavailable');
    const result = (await response.json()) as Rate;
    if (!(
      typeof result.rate === 'number' &&
      Number.isFinite(result.rate) &&
      result.rate > 0 &&
      validDate(result.rateDate) &&
      result.rateDate <= date
    ))
      throw new Error('Invalid rate response');
    cache.set(key, result);
    return result;
  })();
  inFlight.set(key, work);
  void work.finally(() => inFlight.delete(key)).catch(() => {});
  return work;
}
