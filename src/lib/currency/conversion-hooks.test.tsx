import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { visit } from '@/test/fixtures';
import { useReceiptConversion } from './use-receipt-conversion';
import { useBackgroundConversions } from './use-background-conversions';
import { lookupRate } from './rate-client';
import { automaticConversion, receiptInputs, type Currency, type Rate } from './currency';
import type { Repository } from '../garage/repository';

vi.mock('./rate-client', () => ({ lookupRate: vi.fn() }));
beforeEach(() => {
  vi.mocked(lookupRate).mockReset();
});
const foreign = { ...visit, currency: 'MXN' as Currency };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('ignores stale rate responses after input edits and manual entry', async () => {
  const first = deferred<Rate>(),
    second = deferred<Rate>();
  vi.mocked(lookupRate).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const hook = renderHook(
    ({ amount }) => useReceiptConversion(foreign, 'MXN', foreign.date, amount, 'USD'),
    { initialProps: { amount: '150.00' } },
  );
  hook.rerender({ amount: '200.00' });
  act(() => hook.result.current.change('11.11'));
  await act(async () => {
    first.resolve({ rate: 0.1, rateDate: foreign.date });
    second.resolve({ rate: 0.2, rateDate: foreign.date });
  });
  expect(hook.result.current.conversion).toMatchObject({
    source: 'manual',
    totalCostCents: 20000,
    convertedCents: 1111,
  });
});
it('keeps saved estimates frozen and does not confuse targets when home currency changes', async () => {
  const original = {
    ...foreign,
    conversions: {
      USD: automaticConversion(receiptInputs(foreign), { rate: 0.05, rateDate: foreign.date }),
    },
  };
  vi.mocked(lookupRate).mockResolvedValue({ rate: 0.07, rateDate: foreign.date });
  const hook = renderHook(
    ({ target }) => useReceiptConversion(original, 'MXN', foreign.date, '150.00', target),
    { initialProps: { target: 'USD' as Currency } },
  );
  expect(hook.result.current.conversion?.convertedCents).toBe(750);
  expect(lookupRate).not.toHaveBeenCalled();
  hook.rerender({ target: 'CAD' });
  await waitFor(() => expect(hook.result.current.conversion?.convertedCents).toBe(1050));
});
it('exposes unavailable rates and supports retry and zero-cost manual entry', async () => {
  vi.mocked(lookupRate)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ rate: 0.05, rateDate: foreign.date });
  const hook = renderHook(() => useReceiptConversion(undefined, 'MXN', foreign.date, '0', 'USD'));
  await waitFor(() => expect(hook.result.current.status).toBe('pending'));
  act(() => hook.result.current.retry());
  await waitFor(() => expect(hook.result.current.conversion?.convertedCents).toBe(0));
  act(() => hook.result.current.change('0'));
  expect(hook.result.current.conversion?.source).toBe('manual');
});
it('reconciles successful background writes even when an effect is replaced during persistence', async () => {
  vi.mocked(lookupRate).mockResolvedValue({ rate: 0.05, rateDate: foreign.date });
  const saving = deferred<void>();
  const repository = { saveConversion: vi.fn(() => saving.promise) } as unknown as Repository;
  const refresh = vi.fn(async () => {});
  const hook = renderHook(
    ({ visits }) => useBackgroundConversions(repository, visits, 'USD', refresh),
    { initialProps: { visits: [foreign] } },
  );
  await waitFor(() => expect(repository.saveConversion).toHaveBeenCalledOnce());
  hook.rerender({ visits: [{ ...foreign, notes: 'Edited while saving' }] });
  await act(async () => saving.resolve());
  await waitFor(() => expect(refresh).toHaveBeenCalled());
});
it('finishes a missing conversion after switching away and back during its lookup', async () => {
  const usd = deferred<Rate>(),
    cad = deferred<Rate>();
  vi.mocked(lookupRate).mockImplementation((_base, target) =>
    target === 'USD' ? usd.promise : cad.promise,
  );
  const repository = { saveConversion: vi.fn(async () => {}) } as unknown as Repository;
  const refresh = vi.fn(async () => {});
  const visits = [foreign];
  const hook = renderHook(
    ({ target }) => useBackgroundConversions(repository, visits, target, refresh),
    { initialProps: { target: 'USD' as Currency } },
  );
  hook.rerender({ target: 'CAD' });
  hook.rerender({ target: 'USD' });
  await act(async () => {
    usd.resolve({ rate: 0.05, rateDate: foreign.date });
    cad.resolve({ rate: 0.07, rateDate: foreign.date });
  });
  await waitFor(() => expect(repository.saveConversion).toHaveBeenCalledOnce());
  expect(repository.saveConversion).toHaveBeenCalledWith(
    foreign,
    'USD',
    expect.objectContaining({ convertedCents: 750 }),
  );
});
