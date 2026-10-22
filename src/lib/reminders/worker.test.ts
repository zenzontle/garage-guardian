import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runReminders } from './worker';
import { reminderStore } from './store.test-helper';

const config = { origin: 'https://garage.example', sender: 'sender@example.com', apiKey: 'key' };
let store: ReturnType<typeof reminderStore>;
let send: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-05T16:05:00Z'));
  store = reminderStore();
  send = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ messageId: 'provider-id' }), { status: 201 }),
  );
  vi.stubGlobal('fetch', send);
});
afterEach(() => vi.useRealTimers());

it.each([false, true])(
  'removes vehicles archived between preparation and submission (all: %s)',
  async (all) => {
    store.addAccount('alice');
    store.tables.cars.push({ ...store.tables.cars[0], id: 'second-car', name: 'Second car' });
    store.tables.schedule_items.push({
      ...store.tables.schedule_items[0],
      id: 'second-task',
      car_id: 'second-car',
    });
    const identify = store.getUserById.getMockImplementation()!;
    store.getUserById.mockImplementation(async (id) => {
      store.tables.cars[0].is_archived = true;
      if (all) store.tables.cars[1].is_archived = true;
      return identify(id);
    });
    expect(await runReminders(store.db, config)).toMatchObject(
      all ? { skipped: 1, accepted: 0 } : { skipped: 0, accepted: 1 },
    );
    expect(store.tables.reminder_deliveries[0]).toMatchObject({
      item_count: all ? 0 : 1,
      status: all ? 'skipped' : 'accepted',
    });
    if (all) expect(send).not.toHaveBeenCalled();
    else {
      const body = JSON.parse(String(send.mock.calls[0][1]?.body));
      expect(body.textContent).not.toContain('alice car');
      expect(body.textContent).toContain('Second car');
    }
  },
);

it('sends isolated bilingual digests and persists provider acceptance', async () => {
  store.addAccount('alice');
  store.addAccount('bob', 'es');
  const result = await runReminders(store.db, config);
  expect(result.accepted).toBe(2);
  const bodies = send.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
  expect(bodies[0].to).toEqual([{ email: 'alice@example.com' }]);
  expect(bodies[0].htmlContent).toContain('/cars/alice-car');
  expect(bodies[0].htmlContent).not.toContain('bob');
  expect(bodies[1].subject).toContain('mantenimiento');
  expect(bodies[1].textContent).not.toContain('alice');
  expect(
    store.tables.reminder_deliveries.every(
      (row) => row.status === 'accepted' && row.provider_message_id === 'provider-id',
    ),
  ).toBe(true);
  for (const call of store.calls.filter((call) =>
    ['cars', 'schedule_items', 'visits'].includes(call.table),
  ))
    expect(call.filters.some(([, field]) => field === 'user_id')).toBe(true);
});

it('does not double-send for concurrent or repeated runs', async () => {
  store.addAccount('alice');
  await Promise.all([runReminders(store.db, config), runReminders(store.db, config)]);
  store.tables.notification_preferences[0].next_scheduled_at = '2026-10-05T16:00:00.000Z';
  await runReminders(store.db, config);
  expect(send).toHaveBeenCalledTimes(1);
  expect(store.tables.reminder_deliveries).toHaveLength(1);
});

it.each([400, 401, 429, 500, 503, 408])('retains provider %i without retrying', async (code) => {
  store.addAccount('alice');
  send.mockResolvedValue(new Response('{}', { status: code }));
  await runReminders(store.db, config);
  await runReminders(store.db, config);
  expect(send).toHaveBeenCalledTimes(1);
  expect(store.tables.reminder_deliveries[0]).toMatchObject({
    status: code >= 500 || code === 408 ? 'unknown' : 'failed',
    failure_code: `provider_${code}`,
  });
});

it('retains an unknown timeout and recovers an abandoned claim without resending', async () => {
  store.addAccount('alice');
  send.mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
  await runReminders(store.db, config);
  expect(store.tables.reminder_deliveries[0].status).toBe('unknown');
  store.tables.reminder_deliveries[0].status = 'processing';
  vi.setSystemTime(new Date('2026-10-05T16:20:00Z'));
  await runReminders(store.db, config);
  expect(store.tables.reminder_deliveries[0].failure_code).toBe('processing_abandoned');
  expect(send).toHaveBeenCalledTimes(1);
});

it('does not resend after an accepted message cannot be recorded', async () => {
  store.addAccount('alice');
  store.failOutcome();
  expect((await runReminders(store.db, config)).errors).toBe(1);
  await runReminders(store.db, config);
  expect(send).toHaveBeenCalledTimes(1);
  expect(store.tables.reminder_deliveries[0].status).toBe('processing');
});

it('uses confirmed current email, ignores pending email, and skips unconfirmed users', async () => {
  store.addAccount('alice');
  store.addAccount('bob');
  store.getUserById.mockImplementation(async (id) => ({
    data: {
      user: {
        id,
        email: 'confirmed@example.com',
        new_email: 'pending@example.com',
        email_confirmed_at: id === 'alice' ? '2026-01-01' : '',
      },
    },
    error: null,
  }));
  expect(await runReminders(store.db, config)).toMatchObject({ accepted: 1, skipped: 1 });
  expect(JSON.parse(String(send.mock.calls[0][1]?.body)).to).toEqual([
    { email: 'confirmed@example.com' },
  ]);
});

it('rechecks opt-in after claiming', async () => {
  store.addAccount('alice');
  const claim = store.rpc.getMockImplementation()!;
  store.rpc.mockImplementation(async (...args) => {
    const result = await claim(...args);
    store.tables.notification_preferences[0].enabled = false;
    return result;
  });
  expect((await runReminders(store.db, config)).skipped).toBe(1);
  expect(send).not.toHaveBeenCalled();
});

it('skips disabled, future, completed, inactive, and empty garages', async () => {
  for (const id of ['disabled', 'future', 'completed', 'inactive', 'empty']) store.addAccount(id);
  store.tables.notification_preferences[0].enabled = false;
  store.tables.notification_preferences[1].next_scheduled_at = '2027-01-01T16:00:00Z';
  Object.assign(store.tables.schedule_items[2], { interval_miles: null });
  store.tables.visits.push({
    id: 'visit',
    user_id: 'completed',
    car_id: 'completed-car',
    service_date: '2026-10-04',
    odometer: null,
    items: [{ scheduleItemId: 'completed-task' }],
  });
  store.tables.schedule_items[3].is_active = false;
  store.tables.cars = store.tables.cars.filter((row) => row.user_id !== 'empty');
  expect((await runReminders(store.db, config)).skipped).toBe(3);
  expect(send).not.toHaveBeenCalled();
});

it('pages beyond 50 accounts even when claim errors leave older rows in place', async () => {
  for (let i = 0; i < 105; i++) store.addAccount(`owner-${String(i).padStart(3, '0')}`);
  store.failClaims();
  expect(await runReminders(store.db, config)).toMatchObject({ errors: 105, deferred: 105 });
  expect(store.rpc).toHaveBeenCalledTimes(105);
});

it('defers unclaimed work when the time budget is exhausted', async () => {
  store.addAccount('alice');
  expect((await runReminders(store.db, config, new Date(), Date.now())).deferred).toBe(1);
  expect(store.rpc).not.toHaveBeenCalled();
  expect(store.tables.reminder_deliveries).toHaveLength(0);
});

it('collapses missed periods into one current digest and purges only old records', async () => {
  store.addAccount('alice');
  store.tables.notification_preferences[0].next_scheduled_at = '2026-01-01T16:00:00Z';
  store.tables.reminder_deliveries.push({
    user_id: 'old',
    week_start: '2025-01-01',
    attempted_at: '2025-01-01T16:00:00Z',
    status: 'unknown',
  });
  await runReminders(store.db, config);
  expect(send).toHaveBeenCalledTimes(1);
  expect(store.tables.reminder_deliveries).toHaveLength(1);
  expect(store.tables.reminder_deliveries[0].week_start).toBe('2026-10-05');
});
