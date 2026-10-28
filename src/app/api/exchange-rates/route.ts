import { NextResponse } from 'next/server';
import { isCurrency, validDate } from '@/lib/currency/currency';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const base = params.get('base'),
    target = params.get('target'),
    date = params.get('date');
  // Receipt dates are local; ahead of UTC, a user's "today" can be UTC tomorrow.
  const utcToday = new Date().toISOString().slice(0, 10);
  const latestDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (
    [...params.keys()].some((key) => !['base', 'target', 'date'].includes(key)) ||
    [...params.keys()].some((key) => params.getAll(key).length !== 1) ||
    !isCurrency(base) ||
    !isCurrency(target) ||
    !validDate(date) ||
    date > latestDate
  ) {
    return NextResponse.json({ error: { code: 'invalidRateRequest' } }, { status: 400 });
  }
  if (base === target) return NextResponse.json({ rate: 1, rateDate: date });
  const queryDate = date > utcToday ? utcToday : date;
  // Today's ECB rate may not be published yet, so do not pin a rolled-back rate for a day.
  const maxAge = queryDate === utcToday ? 3600 : 86400;
  try {
    // Fixed host/path; only currency pairs and the date ever leave this server.
    // ECB dates roll back to the latest publication on or before the requested day.
    const response = await fetch(
      `https://api.frankfurter.dev/v2/providers/ecb/rate/${base}/${target}?date=${queryDate}`,
      {
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
        next: { revalidate: maxAge },
      },
    );
    if (!response.ok) throw new Error('Rate unavailable');
    const result = (await response.json()) as {
      base: unknown;
      quote: unknown;
      rate: unknown;
      date: unknown;
    };
    if (
      result.base !== base ||
      result.quote !== target ||
      typeof result.rate !== 'number' ||
      !Number.isFinite(result.rate) ||
      result.rate <= 0 ||
      !validDate(result.date) ||
      result.date > date
    )
      throw new Error('Invalid rate response');
    return NextResponse.json(
      { rate: result.rate, rateDate: result.date },
      { headers: { 'Cache-Control': `public, max-age=${maxAge}` } },
    );
  } catch {
    return NextResponse.json({ error: { code: 'rateUnavailable' } }, { status: 503 });
  }
}
