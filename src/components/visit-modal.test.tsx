import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { expect, it, vi } from 'vitest';
import en from '../../messages/en.json';
import { car, schedule, visit } from '@/test/fixtures';
import { LocalRepository } from '@/lib/repository';
import { VisitModal } from './visit-modal';

it.each(['', '0'])('saves an unknown odometer and a zero total from %j', async (cost) => {
  const repository = new LocalRepository();
  const onSave = vi.fn(async (saved) => repository.saveVisit(saved));
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <VisitModal
        cars={[car]}
        visits={[]}
        schedules={[schedule]}
        repository={repository}
        onClose={vi.fn()}
        onSave={onSave}
      />
    </NextIntlClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Odometer (miles)'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Total cost (USD)'), { target: { value: cost } });
  fireEvent.change(screen.getByLabelText('Service item name'), { target: { value: 'Inspection' } });
  await userEvent.click(screen.getByRole('button', { name: 'Save visit' }));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  await waitFor(async () => {
    expect((await repository.load()).visits[0]).toMatchObject({
      odometer: null,
      totalCostCents: 0,
    });
  });
});

it('keeps an unknown reading empty when editing and puts Scheduled service after Other', () => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <VisitModal
        item={{ ...visit, odometer: null }}
        cars={[car]}
        visits={[visit]}
        schedules={[schedule, { ...schedule, id: 'service', name: 'Scheduled service' }]}
        repository={new LocalRepository()}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
  expect(screen.getByLabelText('Odometer (miles)')).toHaveProperty('value', '');
  expect(
    screen
      .getAllByRole('option')
      .map((option) => option.textContent)
      .slice(-3),
  ).toEqual(['Other / custom', 'Scheduled service', 'Oil change']);
  expect(screen.queryByRole('combobox', { name: 'Language' })).toBeNull();
});
