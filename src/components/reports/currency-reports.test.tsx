import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { expect, it } from 'vitest';
import { car, visit } from '@/test/fixtures';
import en from '../../../messages/en.json';
import es from '../../../messages/es.json';
const messages = { en, es };
import { ReportsPage } from './reports-page';
import { Dashboard } from '../dashboard/dashboard';

it.each(['en', 'es'] as const)(
  'shows excluded pending expenses and explicit reporting codes in %s',
  (locale) => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="UTC">
        <ReportsPage homeCurrency="CAD" cars={[car]} visits={[{ ...visit, currency: 'MXN' }]} />
        <Dashboard
          homeCurrency="CAD"
          cars={[car]}
          visits={[{ ...visit, date: new Date().toISOString().slice(0, 10), currency: 'MXN' }]}
          allDue={[]}
          onAddCar={() => {}}
          onAddVisit={() => {}}
        />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getAllByText(messages[locale].currency.incomplete.replace('{count}', '1')).length,
    ).toBe(2);
    expect(screen.getAllByText(/CAD/).length).toBeGreaterThan(0);
    expect(screen.getByText(/MXN/)).toBeDefined();
  },
);
