import { expect, it } from 'vitest';
import { reminderOrigin, renderDigest } from './email';
import { loadReminderItems } from './maintenance';
import { reminderStore } from './store.test-helper';

it.each([
  undefined,
  '',
  'http://example.com',
  'https://user:pass@example.com',
  'https://example.com/path',
  'https://example.com?bad=1',
  'https://example.com/#hash',
  'javascript:alert(1)',
])('rejects unsafe origin %s', (origin) => {
  expect(() => reminderOrigin(origin)).toThrow();
});
it('normalizes a secure origin', () =>
  expect(reminderOrigin('https://garage.example/')).toBe('https://garage.example'));
it.each(['en', 'es'] as const)(
  'renders safe HTML and useful plain text in %s',
  async (language) => {
    const store = reminderStore();
    store.addAccount('owner');
    store.addAccount('metric');
    store.tables.cars[0].name = '<script>alert("x")</script>';
    store.tables.schedule_items[0].name = 'Oil & <filter>';
    store.tables.schedule_items[0].first_due_date = '2026-10-10';
    store.tables.cars[1].distance_unit = 'kilometers';
    const items = [
      ...(await loadReminderItems(store.db, 'owner', '2026-10-05')),
      ...(await loadReminderItems(store.db, 'metric', '2026-10-05')),
    ];
    const email = renderDigest(items, language, 'https://garage.example');
    expect(email.htmlContent).not.toContain('<script>');
    expect(email.htmlContent).toContain('Oil &amp; &lt;filter&gt;');
    expect(email.htmlContent).toContain('href="https://garage.example/cars/owner-car"');
    expect(email.htmlContent).toContain('href="https://garage.example/settings/notifications"');
    expect(email.textContent).toContain('Oil & <filter>');
    expect(email.textContent).toContain(' mi');
    expect(email.textContent).toContain(' km');
    expect(email.subject).toContain(language === 'en' ? 'maintenance' : 'mantenimiento');
    expect(email.textContent).toContain('2026');
  },
);
