import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { InteractionTestProvider } from '@/test/interaction-wrapper';
import { car } from '@/test/fixtures';
import { LocalRepository } from '@/lib/garage/repository';
import { VisitModal } from './visit-modal';
import en from '../../../messages/en.json';
import es from '../../../messages/es.json';
const messages = { en, es };
import { lookupRate } from '@/lib/currency/rate-client';

vi.mock('@/lib/currency/rate-client', () => ({ lookupRate: vi.fn() }));
beforeEach(() => {
  vi.mocked(lookupRate).mockReset();
});
it.each(['en', 'es'] as const)(
  'supports offline save, manual entry, keyboard use, and draft protection in %s',
  async (locale) => {
    const copy = messages[locale];
    vi.mocked(lookupRate).mockRejectedValue(new Error('offline'));
    const close = vi.fn(),
      save = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <InteractionTestProvider locale={locale}>
        <VisitModal
          homeCurrency="CAD"
          cars={[car]}
          visits={[]}
          schedules={[]}
          repository={new LocalRepository()}
          onClose={close}
          onSave={save}
        />
      </InteractionTestProvider>,
    );
    const currency = screen.getByLabelText(copy.currency.receipt);
    expect((currency as HTMLSelectElement).value).toBe('CAD');
    currency.focus();
    await user.keyboard('{ArrowDown}');
    await user.selectOptions(currency, 'MXN');
    fireEvent.change(screen.getByLabelText(copy.visit.total.replace('{currency}', 'MXN')), {
      target: { value: '200' },
    });
    fireEvent.change(screen.getByLabelText(copy.visit.itemName), {
      target: { value: 'Materials' },
    });
    await screen.findByText(copy.currency.pending);
    await user.click(screen.getByRole('button', { name: copy.shared.cancel }));
    await screen.findByRole('alertdialog', { name: copy.interactions.unsavedTitle });
    expect(close).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: copy.interactions.keepEditing }));
    const converted = screen.getByLabelText(copy.currency.converted.replace('{currency}', 'CAD'));
    fireEvent.change(converted, { target: { value: '15.25' } });
    expect(screen.getByText(copy.currency.manual)).toBeDefined();
    await user.click(screen.getByRole('button', { name: copy.visit.save }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]).toMatchObject([
      {
        currency: 'MXN',
        totalCostCents: 20000,
        conversions: { CAD: { source: 'manual', convertedCents: 1525 } },
      },
      ['CAD'],
    ]);
  },
);
it('allows a foreign receipt to save with an unavailable conversion', async () => {
  vi.mocked(lookupRate).mockRejectedValue(new Error('offline'));
  const save = vi.fn(async () => {});
  render(
    <InteractionTestProvider>
      <VisitModal
        homeCurrency="USD"
        cars={[car]}
        visits={[]}
        schedules={[]}
        repository={new LocalRepository()}
        onClose={vi.fn()}
        onSave={save}
      />
    </InteractionTestProvider>,
  );
  fireEvent.change(screen.getByLabelText('Receipt currency'), { target: { value: 'MXN' } });
  fireEvent.change(screen.getByLabelText('Service item name'), { target: { value: 'Materials' } });
  await screen.findByText(messages.en.currency.pending);
  await userEvent.click(screen.getByRole('button', { name: 'Save visit' }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0]).toMatchObject([
    { currency: 'MXN', totalCostCents: 0, conversions: {} },
    [],
  ]);
});
