import { testRouter } from '../../test/garage-router';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, expect, it, vi } from 'vitest';
import { NotificationPreferencesForm } from './notification-preferences-form';
import { notificationRequest } from '@/lib/notifications/notification-client';
import type { NotificationPreferences } from '@/lib/notifications/notification-preferences';
import en from '../../../messages/en.json';
import es from '../../../messages/es.json';
import { InteractionProvider } from '../interaction/interaction-provider';
import Link from '../interaction/guarded-link';

vi.mock('@/lib/notifications/notification-client', () => ({ notificationRequest: vi.fn() }));
const defaults: NotificationPreferences = {
  enabled: false,
  weekday: 1,
  emailLanguage: 'en',
  nextScheduledAt: null,
};
beforeEach(() => vi.mocked(notificationRequest).mockResolvedValue(null));
function view(locale: 'en' | 'es' = 'en', userId = 'alice') {
  return (
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : es} timeZone="UTC">
      <InteractionProvider>
        <NotificationPreferencesForm key={userId} userId={userId} />
        <Link href="/reports">Leave</Link>
      </InteractionProvider>
    </NextIntlClientProvider>
  );
}

it('protects failed-save edits, clears the guard on save, and treats loaded or reverted preferences as clean', async () => {
  testRouter.reset('/settings/notifications');
  const user = userEvent.setup();
  render(view());
  await screen.findByRole('checkbox');
  await user.selectOptions(screen.getByLabelText(en.notifications.weekday), '5');
  await user.selectOptions(screen.getByLabelText(en.notifications.weekday), '1');
  await user.click(screen.getByText('Leave'));
  expect(testRouter.url).toBe('/reports');
  expect(screen.queryByRole('alertdialog')).toBeNull();
  await user.click(screen.getByRole('checkbox'));
  vi.mocked(notificationRequest).mockRejectedValueOnce(new Error('offline'));
  await user.click(screen.getByText(en.notifications.save));
  await screen.findByRole('alert');
  await user.click(screen.getByText('Leave'));
  expect(screen.getByRole('alertdialog')).toBeDefined();
  await user.click(screen.getByText(en.interactions.keepEditing));
  vi.mocked(notificationRequest).mockResolvedValueOnce({ ...defaults, enabled: true });
  await user.click(screen.getByText(en.notifications.save));
  await screen.findByText(en.notifications.saved);
  await user.click(screen.getByText('Leave'));
  expect(screen.queryByRole('alertdialog')).toBeNull();
});

it.each(['en', 'es'] as const)(
  'opts in explicitly and saves translated preferences in %s',
  async (locale) => {
    const copy = locale === 'en' ? en : es;
    const user = userEvent.setup();
    render(view(locale));
    const checkbox = await screen.findByRole('checkbox', { name: copy.notifications.enabled });
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText(copy.notifications.language) as HTMLSelectElement).value).toBe(
      locale,
    );
    await user.click(checkbox);
    await user.selectOptions(screen.getByLabelText(copy.notifications.weekday), '5');
    vi.mocked(notificationRequest).mockResolvedValue({
      ...defaults,
      enabled: true,
      weekday: 5,
      emailLanguage: locale,
    });
    await user.click(screen.getByRole('button', { name: copy.notifications.save }));
    await screen.findByText(copy.notifications.saved);
    expect(notificationRequest).toHaveBeenLastCalledWith('alice', expect.any(AbortSignal), {
      enabled: true,
      weekday: 5,
      emailLanguage: locale,
    });
  },
);

it('keeps saved email language when the app language changes', async () => {
  vi.mocked(notificationRequest).mockResolvedValue({ ...defaults, emailLanguage: 'es' });
  const app = render(view());
  expect(
    ((await screen.findByLabelText(en.notifications.language)) as HTMLSelectElement).value,
  ).toBe('es');
  app.rerender(view('es'));
  expect((screen.getByLabelText(es.notifications.language) as HTMLSelectElement).value).toBe('es');
  expect(notificationRequest).toHaveBeenCalledTimes(1);
});

it('offers retry on load failure and keeps edits after save failure', async () => {
  vi.mocked(notificationRequest).mockRejectedValueOnce(new Error('offline'));
  const user = userEvent.setup();
  render(view());
  await user.click(await screen.findByRole('button', { name: en.shared.retry }));
  await user.click(await screen.findByRole('checkbox'));
  vi.mocked(notificationRequest).mockRejectedValueOnce(new Error('offline'));
  await user.click(screen.getByRole('button', { name: en.notifications.save }));
  await screen.findByRole('alert');
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByText(en.notifications.saved)).toBeNull();
});

it('ignores a late response after switching accounts', async () => {
  let finish!: (value: NotificationPreferences) => void;
  vi.mocked(notificationRequest).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const app = render(view('en', 'alice'));
  app.rerender(view('en', 'bob'));
  await screen.findByRole('checkbox');
  await act(async () => finish({ ...defaults, enabled: true, emailLanguage: 'es' }));
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText(en.notifications.language) as HTMLSelectElement).value).toBe('en');
});

it('blocks duplicate saves while the request is pending', async () => {
  const app = render(view());
  await screen.findByRole('checkbox');
  let finish!: (value: NotificationPreferences) => void;
  vi.mocked(notificationRequest).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const form = screen.getByRole('form');
  fireEvent.submit(form);
  await waitFor(() => expect(screen.getByRole('checkbox').matches(':disabled')).toBe(true));
  fireEvent.submit(form);
  expect(notificationRequest).toHaveBeenCalledTimes(2);
  await act(async () => finish(defaults));
  app.unmount();
});
