import { NextIntlClientProvider } from 'next-intl';
import { renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { messages, type Locale } from './config';
import { useDisplay } from './use-display';
import { getDueItem } from '@/lib/due';
import { car, schedule } from '@/test/fixtures';

function display(locale: Locale) {
  return renderHook(useDisplay, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <NextIntlClientProvider
        locale={locale}
        messages={messages[locale]}
        timeZone="America/Phoenix"
      >
        {children}
      </NextIntlClientProvider>
    ),
  }).result.current;
}

it('formats numbers and USD while retaining the date-only calendar day in a negative-offset timezone', () => {
  const en = display('en'),
    es = display('es');
  expect(en.displayDate('2026-09-25')).toBe('Sep 25, 2026');
  expect(es.displayDate('2026-09-25')).toContain('25');
  expect(es.money(123456)).toBe(
    new Intl.NumberFormat('es', { style: 'currency', currency: 'USD' }).format(1234.56),
  );
  expect(es.formatDistance(48250, 'kilometers')).toBe(
    `${new Intl.NumberFormat('es').format(48250)} km`,
  );
  expect(es.formatDistance(48250, 'miles')).toBe(`${new Intl.NumberFormat('es').format(48250)} mi`);
});

it('renders whole due descriptions for both languages without changing calculations', () => {
  const en = display('en'),
    es = display('es');
  const base = getDueItem({ ...schedule, firstDueDate: '2026-09-25' }, car, [], '2026-09-20');
  expect(en.dueDescription(base)).toBe('by Sep 25, 2026 or at 5,000 mi');
  expect(es.dueDescription(base)).toBe(
    `para el ${es.displayDate('2026-09-25')} o a los ${es.formatDistance(5000, 'miles')}`,
  );
  expect(es.dueDescription({ ...base, dueMiles: null })).toBe(
    `para el ${es.displayDate('2026-09-25')}`,
  );
  expect(es.dueDescription({ ...base, dueDate: null })).toBe(
    `a los ${es.formatDistance(5000, 'miles')}`,
  );
  expect(es.dueDescription({ ...base, status: 'setup' })).toBe(
    'Añade una fecha de vencimiento o una lectura del odómetro',
  );
  expect(es.dueDescription({ ...base, status: 'completed' })).toBe('Tarea única completada');
  expect(base).toMatchObject({
    status: 'upcoming',
    dueMiles: 5000,
    dueDate: '2026-09-25',
    daysRemaining: 5,
    milesRemaining: 4900,
  });
});
