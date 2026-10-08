import { loadGarageTestApp, testRouter } from '../test/garage-router';
import * as React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clear } from 'idb-keyval';
import { createClient } from '@supabase/supabase-js';
import { account, fakeSupabase } from '../test/fake-supabase';
import en from '../../messages/en.json';
import es from '../../messages/es.json';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
let cloud: ReturnType<typeof fakeSupabase>;
beforeEach(async () => {
  testRouter.reset('/signin');
  localStorage.clear();
  sessionStorage.clear();
  await clear();
  vi.resetModules();
  vi.doMock('react', () => React);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://garage.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'test-key');
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en']);
  cloud = fakeSupabase();
  vi.mocked(createClient).mockReturnValue(
    cloud.client as unknown as ReturnType<typeof createClient>,
  );
});
describe.each([
  ['en', en],
  ['es', es],
] as const)('%s account workflows', (locale, copy) => {
  it('preserves entered email through recovery/resend, announces generic copy, and enforces cooldown', async () => {
    localStorage.setItem('garage-guardian:locale', locale);
    const App = await loadGarageTestApp();
    const user = userEvent.setup();
    render(<App />);
    fireEvent.change(await screen.findByLabelText(copy.account.email), {
      target: { value: 'owner@example.com' },
    });
    await user.click(screen.getByRole('button', { name: copy.account.forgotPassword }));
    expect(document.activeElement).toBe(screen.getByLabelText(copy.account.email));
    expect(screen.queryByLabelText(copy.account.password)).toBeNull();
    await user.click(screen.getByRole('button', { name: copy.account.sendRecovery }));
    expect((await screen.findByRole('status')).textContent).toBe(copy.account.emailSent);
    await user.click(screen.getByRole('button', { name: copy.account.backSignin }));
    await user.click(screen.getByRole('button', { name: copy.account.resendConfirmation }));
    expect((screen.getByLabelText(copy.account.email) as HTMLInputElement).value).toBe(
      'owner@example.com',
    );
    await user.click(screen.getByRole('button', { name: copy.account.resendConfirmation }));
    expect(
      (screen.getByRole('button', { name: copy.account.resendConfirmation }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.getAllByRole('status').some((status) => status.textContent === copy.account.emailSent),
    ).toBe(true);
    await user.click(screen.getByRole('button', { name: copy.account.backSignin }));
    await user.click(screen.getByRole('button', { name: copy.account.resendConfirmation }));
    expect(
      (screen.getByRole('button', { name: copy.account.resendConfirmation }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
  it('allows resend after an unconfirmed-email error and from the signup notice', async () => {
    localStorage.setItem('garage-guardian:locale', locale);
    const App = await loadGarageTestApp();
    const user = userEvent.setup();
    render(<App />);
    cloud.auth.signInWithPassword.mockRejectedValueOnce({ code: 'email_not_confirmed' });
    await user.type(await screen.findByLabelText(copy.account.email), 'owner@example.com');
    await user.type(screen.getByLabelText(copy.account.password), 'password');
    await user.click(screen.getByRole('button', { name: copy.account.signIn }));
    expect((await screen.findByRole('alert')).textContent).toBe(copy.errors.emailNotConfirmed);
    await user.click(screen.getByRole('button', { name: copy.account.resendConfirmation }));
    expect((screen.getByLabelText(copy.account.email) as HTMLInputElement).value).toBe(
      'owner@example.com',
    );
    await user.click(screen.getByRole('button', { name: copy.account.backSignin }));
    await user.click(screen.getByRole('button', { name: copy.account.createLink }));
    cloud.requireConfirmation();
    await user.type(screen.getByLabelText(copy.account.password), 'password');
    await user.click(screen.getByRole('button', { name: copy.account.create }));
    await user.click(await screen.findByRole('link', { name: copy.account.resendConfirmation }));
    await screen.findByRole('heading', { name: copy.account.resendTitle });
    expect((screen.getByLabelText(copy.account.email) as HTMLInputElement).value).toBe(
      'owner@example.com',
    );
  });
  it('opens accessible settings even after cloud loading fails, validates mismatch, and traps/restores keyboard focus', async () => {
    localStorage.setItem('garage-guardian:locale', locale);
    testRouter.reset('/');
    cloud.emit(account());
    cloud.execute.mockResolvedValueOnce({ data: null, error: new Error('Cloud offline') });
    const App = await loadGarageTestApp();
    const user = userEvent.setup();
    render(<App />);
    const trigger = await screen.findByRole('button', { name: copy.account.settings });
    await screen.findByRole('alert');
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: copy.account.settings });
    const form = within(dialog).getByRole('form', { name: copy.account.changePassword });
    await user.type(within(form).getByLabelText(copy.account.currentPassword), 'password');
    await user.type(within(form).getByLabelText(copy.account.newPassword), 'new-password');
    await user.type(within(form).getByLabelText(copy.account.confirmPassword), 'mismatch');
    await user.click(within(form).getByRole('button', { name: copy.account.changePassword }));
    expect((await within(form).findByRole('alert')).textContent).toBe(copy.errors.passwordMismatch);
    const last = within(dialog).getByRole('button', { name: copy.account.deleteAccount });
    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(within(dialog).getByRole('combobox'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('handles recovery sessions independently of cloud loading and returns to sign-in after reset', async () => {
    localStorage.setItem('garage-guardian:locale', locale);
    testRouter.reset('/');
    const App = await loadGarageTestApp();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: copy.dashboard.title });
    act(() => cloud.emit(account(), 'PASSWORD_RECOVERY'));
    await screen.findByRole('heading', { name: copy.account.resetTitle });
    expect(testRouter.url).toBe('/auth/recovery');
    await user.type(screen.getByLabelText(copy.account.newPassword), 'new-password');
    await user.type(screen.getByLabelText(copy.account.confirmPassword), 'new-password');
    await user.click(screen.getByRole('button', { name: copy.account.resetPassword }));
    await screen.findByRole('heading', { name: copy.account.welcome });
    expect(screen.getByRole('status').textContent).toBe(copy.account.passwordChanged);
  });
});

it('disables all account forms during an in-flight request and retains drafts on network failure', async () => {
  testRouter.reset('/');
  cloud.emit(account());
  const App = await loadGarageTestApp();
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('heading', { name: en.dashboard.title });
  await user.click(await screen.findByRole('button', { name: en.account.settings }));
  const form = screen.getByRole('form', { name: en.account.changeEmail });
  let fail!: () => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise((_, reject) => {
          fail = () => reject(new Error('Offline'));
        }),
    ),
  );
  fireEvent.change(within(form).getByLabelText(en.account.currentPassword), {
    target: { value: 'password' },
  });
  fireEvent.change(within(form).getByLabelText(en.account.newEmail), {
    target: { value: 'new@example.com' },
  });
  await user.click(within(form).getByRole('button', { name: en.account.changeEmail }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Close' }).hasAttribute('disabled')).toBe(true),
  );
  expect(screen.getAllByRole('group').every((field) => field.hasAttribute('disabled'))).toBe(true);
  await act(async () => fail());
  expect((await within(form).findByRole('alert')).textContent).toBe(en.errors.auth);
  expect((within(form).getByLabelText(en.account.newEmail) as HTMLInputElement).value).toBe(
    'new@example.com',
  );
});

it('shows a revocation failure when Supabase clears the recovery session on a failed sign-out', async () => {
  testRouter.reset('/');
  const App = await loadGarageTestApp();
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('heading', { name: en.dashboard.title });
  act(() => cloud.emit(account(), 'PASSWORD_RECOVERY'));
  await screen.findByRole('heading', { name: en.account.resetTitle });
  cloud.auth.signOut.mockImplementationOnce(async () => {
    cloud.emit(null);
    return { error: new Error('Network unavailable') };
  });
  fireEvent.change(screen.getByLabelText(en.account.newPassword), {
    target: { value: 'new-password' },
  });
  fireEvent.change(screen.getByLabelText(en.account.confirmPassword), {
    target: { value: 'new-password' },
  });
  await user.click(screen.getByRole('button', { name: en.account.resetPassword }));
  expect((await screen.findByRole('alert')).textContent).toBe(en.errors.sessionRevocation);
  expect(screen.queryByText(en.account.passwordChanged)).toBeNull();
  await user.click(screen.getByRole('button', { name: en.account.backSignin }));
  await screen.findByRole('heading', { name: en.account.welcome });
});
