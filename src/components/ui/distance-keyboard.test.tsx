import { fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import { car, schedule } from '@/test/fixtures';
import { CarModal } from '../vehicles/car-modal';
import { ScheduleModal } from '../maintenance/schedule-modal';

it.each(['miles', 'kilometers'] as const)(
  'steps both maintenance %s fields by 5000 without restricting manually entered integers',
  (distanceUnit) => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ScheduleModal
          item={schedule}
          carId={car.id}
          distanceUnit={distanceUnit}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    for (const label of [
      `First due at odometer (${distanceUnit})`,
      `Repeat every ${distanceUnit}`,
    ]) {
      const input = screen.getByLabelText(
        new RegExp(label.replace(/[()]/g, '\\$&')),
      ) as HTMLInputElement;
      fireEvent.change(input, { target: { value: '48250' } });
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      expect(input.value).toBe('53250');
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(input.value).toBe('48250');
      expect(input.validity.valid).toBe(true);
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      expect(input.value).toBe('5000');
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(input.value).toBe(input.min);
    }
  },
);

it.each([false, true])('steps the car reminder by 500 when editing=%s', (editing) => {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <CarModal item={editing ? car : undefined} onClose={vi.fn()} onSave={vi.fn()} />
    </NextIntlClientProvider>,
  );
  const input = screen.getByLabelText('Coming up: miles before due') as HTMLInputElement;
  fireEvent.change(input, { target: { value: '123' } });
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(input.value).toBe('623');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(input.value).toBe('123');
  expect(input.validity.valid).toBe(true);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(input.value).toBe('0');
  fireEvent.change(input, { target: { value: '9800' } });
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(input.value).toBe('10000');
  if (!editing) {
    fireEvent.change(input, { target: { value: '500' } });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.change(screen.getByLabelText('Distance unit'), { target: { value: 'kilometers' } });
    const kilometers = screen.getByLabelText(
      'Coming up: kilometers before due',
    ) as HTMLInputElement;
    expect(kilometers.value).toBe('1000');
    fireEvent.keyDown(kilometers, { key: 'ArrowUp' });
    expect(kilometers.value).toBe('1500');
  }
});
