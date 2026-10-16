import { loadGarageTestApp, testRouter } from '../../test/garage-router';
import * as React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clear } from 'idb-keyval';
import { createClient } from '@supabase/supabase-js';
import { account, fakeSupabase } from '../../test/fake-supabase';
import en from '../../../messages/en.json';
import es from '../../../messages/es.json';

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
  it('retains a password draft after saving email preferences and guards leaving security settings', async () => {
    localStorage.setItem('garage-guardian:locale', locale);
    testRouter.reset('/settings/security');
    cloud.emit(account());
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        url === '/api/account' ? Response.json({ ok: true }) : Response.json({ enabled: false }),
      ),
    );
    const App = await loadGarageTestApp();
    const user = userEvent.setup();
    render(<App />);
    const email = within(await screen.findByRole('form', { name: copy.account.changeEmail }));
    const password = within(screen.getByRole('form', { name: copy.account.changePassword }));
    fireEvent.change(email.getByLabelText(copy.account.currentPassword), {
      target: { value: 'current-password' },
    });
    fireEvent.change(email.getByLabelText(copy.account.newEmail), {
      target: { value: 'changed@example.com' },
    });
    fireEvent.change(password.getByLabelText(copy.account.newPassword), {
      target: { value: 'unfinished-password' },
    });
    await user.click(email.getByRole('button', { name: copy.account.changeEmail }));
    await email.findByRole('status');
    expect(password.getByLabelText(copy.account.newPassword)).toHaveProperty(
      'value',
      'unfinished-password',
    );
    await user.click(
      within(screen.getByRole('navigation', { name: copy.app.mainNavigation })).getByRole('link', {
        name: copy.navigation.reports,
      }),
    );
    expect(screen.getByRole('alertdialog')).toBeDefined();
    expect(testRouter.url).toBe('/settings/security');
    await user.click(screen.getByText(copy.interactions.keepEditing));
    await user.click(screen.getByRole('button', { name: copy.account.openMenu }));
    await user.click(screen.getByRole('button', { name: copy.account.signOut }));
    expect(screen.getByRole('alertdialog')).toBeDefined();
    expect(cloud.auth.signOut).not.toHaveBeenCalled();
    await user.click(screen.getByText(copy.interactions.keepEditing));
    expect(document.activeElement?.textContent).toBe(copy.account.signOut);
    await user.keyboard('{Escape}');
    fireEvent.change(password.getByLabelText(copy.account.newPassword), { target: { value: '' } });
    await user.click(
      within(screen.getByRole('navigation', { name: copy.app.mainNavigation })).getByRole('link', {
        name: copy.navigation.reports,
      }),
    );
    expect(testRouter.url).toBe('/reports');
  });
  it('opens the profile drawer, traps focus, and connects security, notifications and sign-out', async () => {
    localStorage.setItem('garage-guardian:locale', locale);
    testRouter.reset('/');
    cloud.emit(account());
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ preferences: null }) }),
    );
    const App = await loadGarageTestApp();
    const user = userEvent.setup();
    render(<App />);
    const trigger = await screen.findByRole('button', { name: copy.account.openMenu });
    expect(trigger.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(trigger.closest('header')).not.toBeNull();
    expect(screen.queryByText(account().email!)).toBeNull();
    expect(document.querySelector('.account-line')).toBeNull();
    expect(document.querySelector('.storage-account')).toBeNull();
    expect(screen.queryByRole('button', { name: copy.account.settings })).toBeNull();
    expect(screen.queryByRole('button', { name: copy.account.signOut })).toBeNull();
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const drawer = screen.getByRole('dialog', { name: copy.account.settings });
    const close = within(drawer).getByRole('button', { name: copy.shared.close });
    expect(document.activeElement).toBe(close);
    for (const control of [
      within(drawer).getByRole('link', { name: copy.account.settings }),
      within(drawer).getByRole('link', { name: copy.account.notifications }),
      within(drawer).getByRole('link', { name: copy.account.security }),
      within(drawer).getByRole('button', { name: copy.account.signOut }),
      close,
    ]) {
      await user.tab();
      expect(document.activeElement).toBe(control);
    }
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(
      within(drawer).getByRole('button', { name: copy.account.signOut }),
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe('');

    await user.click(trigger);
    await user.click(screen.getByRole('link', { name: copy.account.security }));
    expect(testRouter.url).toBe('/settings/security');
    await screen.findByRole('heading', { name: copy.account.security });
    const security = screen.getByRole('main');
    expect(within(security).getByRole('form', { name: copy.account.changeEmail })).toBeDefined();
    expect(within(security).getByRole('form', { name: copy.account.changePassword })).toBeDefined();
    expect(within(security).queryByRole('region', { name: copy.account.notifications })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(trigger);
    await user.click(screen.getByRole('link', { name: copy.account.notifications }));
    expect(testRouter.url).toBe('/settings/notifications');
    await screen.findByRole('heading', { name: copy.notifications.pageTitle });
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: copy.account.openMenu }));
    await user.click(screen.getByRole('button', { name: copy.account.signOut }));
    await waitFor(() => expect(cloud.auth.signOut).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: copy.account.openMenu })).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows an account icon for guests and offers sign-in from the account page', async () => {
    localStorage.setItem('garage-guardian:locale', locale);
    testRouter.reset('/history');
    const App = await loadGarageTestApp();
    const user = userEvent.setup();
    render(<App />);
    const trigger = await screen.findByRole('button', { name: copy.account.openMenu });
    expect(trigger.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    await user.click(trigger);
    const drawer = screen.getByRole('dialog', { name: copy.account.settings });
    expect(within(drawer).queryByRole('button', { name: copy.account.signOut })).toBeNull();
    expect(
      within(drawer).getByRole('link', { name: copy.account.create }).getAttribute('href'),
    ).toBe('/signup?returnTo=%2Fhistory');
    expect(
      within(drawer).getByRole('link', { name: copy.account.security }).getAttribute('href'),
    ).toBe('/settings/security');
    fireEvent.mouseDown(drawer.parentElement!);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    await user.click(screen.getByRole('link', { name: copy.account.settings }));
    expect(testRouter.url).toBe('/settings/account');
    await screen.findByRole('heading', { name: copy.account.settings });
    const links = screen.getAllByRole('link', { name: copy.account.signIn });
    await user.click(links[links.length - 1]);
    expect(testRouter.url).toBe('/signin?returnTo=%2Fsettings%2Faccount');
    await screen.findByRole('heading', { name: copy.account.welcome });
  });

  it('opens registration from the guest drawer and returns to account settings after signup', async () => {
    localStorage.setItem('garage-guardian:locale', locale);
    testRouter.reset('/settings/account');
    const App = await loadGarageTestApp();
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: copy.account.openMenu }));
    const drawer = screen.getByRole('dialog', { name: copy.account.settings });
    expect(within(drawer).queryByRole('button', { name: copy.account.signOut })).toBeNull();
    await user.click(within(drawer).getByRole('link', { name: copy.account.create }));
    expect(testRouter.url).toBe('/signup?returnTo=%2Fsettings%2Faccount');
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.type(await screen.findByLabelText(copy.account.email), 'new@example.com');
    await user.type(screen.getByLabelText(copy.account.password), 'password');
    await user.click(screen.getByRole('button', { name: copy.account.create }));
    await waitFor(() => expect(testRouter.url).toBe('/settings/account'));
    await user.click(await screen.findByRole('button', { name: copy.account.openMenu }));
    const signedInDrawer = screen.getByRole('dialog', { name: copy.account.settings });
    expect(within(signedInDrawer).queryByRole('link', { name: copy.account.create })).toBeNull();
    expect(
      within(signedInDrawer).getByRole('button', { name: copy.account.signOut }),
    ).toBeDefined();
  });

  it('shows only the current email on the account page and restores pages with browser history', async () => {
    localStorage.setItem('garage-guardian:locale', locale);
    testRouter.reset('/');
    cloud.emit(account());
    const App = await loadGarageTestApp();
    const user = userEvent.setup();
    render(<App />);
    const trigger = await screen.findByRole('button', { name: copy.account.openMenu });
    await user.click(trigger);
    await user.click(screen.getByRole('link', { name: copy.account.settings }));
    expect(testRouter.url).toBe('/settings/account');
    await screen.findByRole('heading', { name: copy.account.settings });
    expect(screen.queryByRole('dialog')).toBeNull();
    const main = screen.getByRole('main');
    expect(
      within(main).getByText(copy.account.currentEmail.replace('{email}', account().email!)),
    ).toBeDefined();
    expect(within(main).queryByRole('form')).toBeNull();
    expect(within(main).queryByRole('checkbox')).toBeNull();
    for (const nav of screen.getAllByRole('navigation')) {
      expect(within(nav).queryAllByRole('link', { current: 'page' })).toHaveLength(0);
    }
    await user.click(trigger);
    await user.click(screen.getByRole('link', { name: copy.account.security }));
    await screen.findByRole('heading', { name: copy.account.security });
    expect(
      within(main)
        .getAllByRole('heading')
        .map((heading) => [heading.tagName, heading.textContent]),
    ).toEqual([
      ['H1', copy.account.security],
      ['H2', copy.account.changeEmail],
      ['H2', copy.account.changePassword],
    ]);
    const email = within(main).getByRole('form', { name: copy.account.changeEmail });
    const password = within(main).getByRole('form', { name: copy.account.changePassword });
    within(email).getByLabelText(copy.account.currentPassword).focus();
    for (const control of [
      within(email).getByLabelText(copy.account.newEmail),
      within(email).getByRole('button', { name: copy.account.changeEmail }),
      within(password).getByLabelText(copy.account.currentPassword),
      within(password).getByLabelText(copy.account.newPassword),
      within(password).getByLabelText(copy.account.confirmPassword),
      within(password).getByRole('button', { name: copy.account.changePassword }),
    ]) {
      await user.tab();
      expect(document.activeElement).toBe(control);
    }
    act(() => testRouter.back());
    await screen.findByRole('heading', { name: copy.account.settings });
    expect(screen.queryByRole('form')).toBeNull();
    act(() => testRouter.forward());
    await screen.findByRole('heading', { name: copy.account.security });
    expect(screen.getAllByRole('form')).toHaveLength(2);
  });
  it('preserves entered email through recovery/resend, announces generic copy, and enforces cooldown', async () => {
    localStorage.setItem('garage-guardian:locale', locale);
    const App = await loadGarageTestApp();
    const user = userEvent.setup();
    render(<App />);
    fireEvent.change(await screen.findByLabelText(copy.account.email), {
      target: { value: 'owner@example.com' },
    });
    await user.click(screen.getByRole('button', { name: copy.account.forgotPassword }));
    await user.click(screen.getByRole('button', { name: copy.interactions.discard }));
    expect(document.activeElement).toBe(screen.getByLabelText(copy.account.email));
    expect(screen.queryByLabelText(copy.account.password)).toBeNull();
    await user.click(screen.getByRole('button', { name: copy.account.sendRecovery }));
    expect((await screen.findByRole('status')).textContent).toBe(copy.account.emailSent);
    await user.click(screen.getByRole('button', { name: copy.account.backSignin }));
    await user.click(screen.getByRole('button', { name: copy.account.resendConfirmation }));
    const discard = screen.queryByRole('button', { name: copy.interactions.discard });
    if (discard) await user.click(discard);
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
    const discard = screen.queryByRole('button', { name: copy.interactions.discard });
    if (discard) await user.click(discard);
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
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    cloud.execute.mockImplementationOnce(async () => {
      await pending;
      return { data: null, error: new Error('Cloud offline') };
    });
    const App = await loadGarageTestApp();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('status');
    await waitFor(() => expect(cloud.execute).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: copy.account.settings })).toBeNull();
    expect(screen.queryByRole('button', { name: copy.account.signOut })).toBeNull();
    await act(async () => release());
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
    const last = within(dialog).getByRole('button', { name: copy.account.changePassword });
    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: copy.shared.close }),
    );
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeDefined();
    await user.click(screen.getByRole('button', { name: copy.interactions.discard }));
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
  it('cancels recovery with local sign-out and clears its marker', async () => {
    localStorage.setItem('garage-guardian:locale', locale);
    testRouter.reset('/');
    const App = await loadGarageTestApp();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: copy.dashboard.title });
    act(() => cloud.emit(account(), 'PASSWORD_RECOVERY'));
    await screen.findByRole('heading', { name: copy.account.resetTitle });
    await user.click(screen.getByRole('button', { name: copy.account.backSignin }));
    await screen.findByRole('heading', { name: copy.account.welcome });
    expect(cloud.auth.signOut).toHaveBeenCalledTimes(1);
    expect(cloud.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(localStorage.getItem('garage-guardian:recovery:https://garage.supabase.co')).toBeNull();
    expect(screen.queryByText(copy.account.passwordChanged)).toBeNull();
  });

  it('preserves a replacement login while recovery cancellation waits for the auth lock', async () => {
    localStorage.setItem('garage-guardian:locale', locale);
    testRouter.reset('/');
    const App = await loadGarageTestApp();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: copy.dashboard.title });
    act(() => cloud.emit(account(), 'PASSWORD_RECOVERY'));
    await screen.findByRole('heading', { name: copy.account.resetTitle });
    // Model the public SDK method taking the lock before reading its session.
    const signOut = cloud.auth.signOut.getMockImplementation()!;
    cloud.client.auth.signOut = async (options) => {
      await cloud.auth._acquireLock(-1, () => signOut({ scope: options?.scope ?? 'global' }));
      return { error: null };
    };
    let release!: () => void;
    let settled!: () => void;
    const finished = new Promise<void>((resolve) => {
      settled = resolve;
    });
    cloud.auth._acquireLock.mockImplementationOnce(async (_timeout, work) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      try {
        return await work();
      } finally {
        settled();
      }
    });
    const back = screen.getByRole('button', { name: copy.account.backSignin });
    await user.click(back);
    await waitFor(() => expect(release).toBeTypeOf('function'));
    expect(back.closest('fieldset')?.disabled).toBe(true);
    act(() => cloud.emit(account('replacement')));
    await act(async () => {
      release();
      await finished;
    });
    expect((await cloud.auth.getSession()).data.session?.user.id).toBe('replacement');
    expect(cloud.auth.signOut).not.toHaveBeenCalled();
    expect(testRouter.url).toBe('/auth/recovery');
  });
});

it('disables all account forms during an in-flight request and retains drafts on network failure', async () => {
  testRouter.reset('/');
  cloud.emit(account());
  const App = await loadGarageTestApp();
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('heading', { name: en.dashboard.title });
  await user.click(await screen.findByRole('button', { name: en.account.openMenu }));
  await user.click(screen.getByRole('link', { name: en.account.security }));
  await screen.findByRole('heading', { name: en.account.security });
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
    expect(screen.getAllByRole('group').every((field) => field.hasAttribute('disabled'))).toBe(
      true,
    ),
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
