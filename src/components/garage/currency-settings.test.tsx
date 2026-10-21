import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { clear } from 'idb-keyval';
import { loadGarageTestApp, testRouter } from '@/test/garage-router';
import en from '../../../messages/en.json';
import es from '../../../messages/es.json';
const messages = { en, es };

beforeEach(async () => {
  await clear();
  localStorage.clear();
  vi.resetModules();
  vi.doMock('react', () => React);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
  testRouter.reset('/settings/account');
});
it.each(['en', 'es'] as const)(
  'saves a guest home currency independently of language with keyboard and draft protection (%s)',
  async (locale) => {
    localStorage.setItem('garage-guardian:locale', locale);
    const copy = messages[locale],
      user = userEvent.setup();
    const App = await loadGarageTestApp();
    render(<App />);
    const select = await screen.findByLabelText(copy.currency.home);
    expect((select as HTMLSelectElement).value).toBe('USD');
    await waitFor(() => expect((select as HTMLSelectElement).disabled).toBe(false));
    await user.selectOptions(select, 'CAD');
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: copy.shared.saveChanges }),
    );
    await user.click(screen.getAllByRole('link', { name: copy.navigation.reports })[0]);
    await screen.findByRole('alertdialog', { name: copy.interactions.unsavedTitle });
    await user.click(screen.getByRole('button', { name: copy.interactions.keepEditing }));
    await user.click(screen.getByRole('button', { name: copy.shared.saveChanges }));
    const { LocalRepository } = await import('@/lib/garage/repository');
    await waitFor(async () =>
      expect((await new LocalRepository().load()).homeCurrency).toBe('CAD'),
    );
    expect(localStorage.getItem('garage-guardian:locale')).toBe(locale);
  },
);
