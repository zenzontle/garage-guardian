import { useEffect, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { useTranslations } from 'next-intl';
import { beforeEach, expect, it, vi } from 'vitest';
import { LocaleProvider, LocaleSelector } from './locale-provider';
import { LOCALE_KEY } from '@/i18n/config';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = 'en';
});
function Harness({ mounted = () => {} }: { mounted?: () => void }) {
  const t = useTranslations('account');
  const [draft, setDraft] = useState('');
  useEffect(mounted, [mounted]);
  return (
    <>
      <LocaleSelector />
      <p>{t('signIn')}</p>
      <input aria-label="Draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
    </>
  );
}

it('keeps English hydration deterministic, resolves saved Spanish, and preserves a draft and mounted child', async () => {
  localStorage.setItem(LOCALE_KEY, 'es');
  const mounted = vi.fn(),
    onRecoverableError = vi.fn();
  const app = (
    <LocaleProvider>
      <Harness mounted={mounted} />
    </LocaleProvider>
  );
  const container = document.createElement('div');
  document.body.append(container);
  container.innerHTML = renderToString(app);
  expect(container.textContent).toContain('Sign in');
  let root: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(container, app, { onRecoverableError });
  });
  expect(screen.getByText('Iniciar sesión')).toBeDefined();
  expect(document.documentElement.lang).toBe('es');
  fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Unfinished' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Idioma' }), { target: { value: 'en' } });
  expect(screen.getByText('Sign in')).toBeDefined();
  expect(document.documentElement.lang).toBe('en');
  expect(localStorage.getItem(LOCALE_KEY)).toBe('en');
  expect((screen.getByLabelText('Draft') as HTMLInputElement).value).toBe('Unfinished');
  expect(mounted).toHaveBeenCalledOnce();
  expect(onRecoverableError).not.toHaveBeenCalled();
  await act(async () => root!.unmount());
  container.remove();
});

it('detects regional browser language and persists only an explicit selection across reloads', () => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['fr', 'es-MX']);
  const app = (
    <LocaleProvider>
      <Harness />
    </LocaleProvider>
  );
  const view = render(app);
  expect(screen.getByText('Iniciar sesión')).toBeDefined();
  expect(localStorage.getItem(LOCALE_KEY)).toBeNull();
  fireEvent.change(screen.getByRole('combobox', { name: 'Idioma' }), { target: { value: 'en' } });
  view.unmount();
  render(app);
  expect(screen.getByText('Sign in')).toBeDefined();
});

it('switches during a session even if both storage reads and writes fail', () => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Storage disabled');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage disabled');
  });
  render(
    <LocaleProvider>
      <Harness />
    </LocaleProvider>,
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'es' } });
  expect(screen.getByText('Iniciar sesión')).toBeDefined();
  expect(document.documentElement.lang).toBe('es');
});
