import { loadGarageTestApp, testRouter } from '@/test/garage-router';
import * as React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { clear } from 'idb-keyval';
import { createClient } from '@supabase/supabase-js';
import { account, fakeSupabase } from '@/test/fake-supabase';
import { car, schedule, visit } from '@/test/fixtures';
import en from '../../../messages/en.json';
import es from '../../../messages/es.json';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
let cloud: ReturnType<typeof fakeSupabase>;
beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
  // Transform the app routes before timing individual interactions; each test still resets modules.
  await loadGarageTestApp();
});
beforeEach(async () => {
  testRouter.reset(`/cars/${car.id}`);
  localStorage.clear();
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
  await clear();
  vi.resetModules();
  vi.doMock('react', () => React);
  cloud = fakeSupabase();
  vi.mocked(createClient).mockReturnValue(
    cloud.client as unknown as ReturnType<typeof createClient>,
  );
});

async function setup(mode: 'local' | 'cloud', archived = false) {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', mode === 'cloud' ? 'https://garage.supabase.co' : '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', mode === 'cloud' ? 'test-key' : '');
  if (mode === 'cloud') cloud.emit(account());
  const { createRepository, LocalRepository, SupabaseRepository } =
    await import('@/lib/garage/repository');
  const backend = createRepository(mode === 'cloud' ? account().id : undefined);
  await backend.saveCar({ ...car, isArchived: archived });
  await backend.saveSchedule({ ...schedule, firstDueDate: '2020-01-01' });
  await backend.saveVisit(visit);
  const GarageApp = await loadGarageTestApp();
  const app = render(<GarageApp />);
  return {
    backend,
    app,
    GarageApp,
    prototype: mode === 'cloud' ? SupabaseRepository.prototype : LocalRepository.prototype,
    user: userEvent.setup(),
  };
}

async function openEditCar(user: ReturnType<typeof userEvent.setup>, copy: typeof en = en) {
  await user.click(await screen.findByRole('button', { name: copy.car.edit }));
  return within(screen.getByRole('dialog'));
}

it('keeps the selected vehicle in its new view after a committed archive fails to refresh', async () => {
  const { prototype, user } = await setup('local');
  await screen.findByRole('button', { name: en.car.edit });
  expect(screen.queryByRole('navigation', { name: en.archive.views })).toBeNull();
  expect(screen.queryByRole('button', { name: en.archive.archive })).toBeNull();
  const dialog = await openEditCar(user);
  vi.spyOn(prototype, 'load').mockRejectedValueOnce(new Error('Refresh failed'));
  await user.click(dialog.getByRole('button', { name: en.archive.archive }));
  await screen.findByText(en.interactions.carArchived);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: en.archive.restore })).toBeDefined();
  expect(screen.getByRole('navigation', { name: en.archive.views })).toBeDefined();
  expect(testRouter.url).toBe(`/cars/${car.id}`);
});

it.each([
  ['local', 'en', en],
  ['cloud', 'es', es],
] as const)(
  'archives/restores %s in %s without confirmation, retains selected details, and preserves edits',
  async (mode, locale, copy) => {
    localStorage.setItem('garage-guardian:locale', locale);
    const { backend, user } = await setup(mode);
    const editor = await openEditCar(user, copy);
    editor.getByRole('button', { name: copy.archive.archive }).focus();
    await user.keyboard('{Enter}');
    // The header updates before the refresh settles; the toast and closed dialog follow it.
    await screen.findByText(copy.interactions.carArchived);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: copy.archive.restore })).toBeDefined();
    expect(screen.getByText(copy.archive.paused)).toBeDefined();
    expect(testRouter.url).toBe(`/cars/${car.id}`);
    expect(
      screen.getByRole('link', { name: copy.archive.archivedView }).getAttribute('aria-current'),
    ).toBe('page');
    expect(screen.getByText(copy.archive.scheduleSaved)).toBeDefined();
    expect(document.querySelector('.schedule-row .status-pill')).toBeNull();
    const dialog = await openEditCar(user, copy);
    expect(dialog.getByRole('button', { name: copy.archive.restore })).toBeDefined();
    fireEvent.change(dialog.getByLabelText(copy.car.nickname), {
      target: { value: 'Edited archived' },
    });
    await user.click(dialog.getByRole('button', { name: copy.shared.saveChanges }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await backend.load()).cars[0]).toMatchObject({
      name: 'Edited archived',
      isArchived: true,
    });
    await user.click(screen.getByRole('button', { name: copy.archive.restore }));
    await screen.findByText(copy.interactions.carRestored);
    expect(screen.queryByRole('button', { name: copy.archive.restore })).toBeNull();
    expect(screen.queryByText(copy.archive.paused)).toBeNull();
    expect(screen.queryByRole('navigation', { name: copy.archive.views })).toBeNull();
    expect(testRouter.url).toBe(`/cars/${car.id}`);
  },
);

it('supports archived direct links, view switching, refresh/back, late receipts, and retained dashboard/report history', async () => {
  const { backend, app, GarageApp, user } = await setup('local', true);
  await screen.findByRole('button', { name: en.archive.restore });
  await user.click(screen.getByRole('link', { name: en.archive.active }));
  await screen.findByText(en.archive.activeEmptyTitle);
  expect(screen.getByRole('link', { name: en.archive.archivedView })).toBeDefined();
  await user.click(screen.getByRole('link', { name: en.archive.viewArchived }));
  await screen.findByRole('button', { name: en.archive.restore });
  act(() => testRouter.back());
  await screen.findByText(en.archive.activeEmptyTitle);
  act(() => testRouter.forward());
  await screen.findByRole('button', { name: en.archive.restore });
  app.unmount();
  render(<GarageApp />);
  await screen.findByRole('button', { name: en.archive.restore });
  act(() => testRouter.push('/'));
  await screen.findByText(en.archive.activeEmptyTitle);
  expect(
    screen.getByText(`${car.name} · ${en.archive.archived} ·`, { exact: false }),
  ).toBeDefined();
  expect(screen.getByRole('link', { name: en.archive.viewArchived })).toBeDefined();
  expect(screen.queryByRole('link', { name: /Daily driver.*Toyota/ })).toBeNull();
  act(() => testRouter.push('/reports'));
  await screen.findByRole('option', { name: `${car.name} (${en.archive.archived})` });
  expect(screen.getAllByText('USD 150.00').length).toBeGreaterThan(0);
  act(() => testRouter.push('/history'));
  await user.click(await screen.findByRole('button', { name: en.shared.logService }));
  const dialog = within(screen.getByRole('dialog'));
  expect(
    dialog.getByRole('option', { name: `${car.name} (${en.archive.archived})` }),
  ).toBeDefined();
  fireEvent.change(dialog.getByRole('textbox', { name: en.visit.itemName }), {
    target: { value: 'Late receipt' },
  });
  fireEvent.change(
    dialog.getByRole('spinbutton', { name: en.visit.total.replace('{currency}', 'USD') }),
    { target: { value: '10' } },
  );
  await user.click(dialog.getByRole('button', { name: en.visit.save }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect((await backend.load()).visits).toHaveLength(2);
  act(() => testRouter.push(`/cars/${car.id}`));
  await user.click(await screen.findByRole('button', { name: en.car.delete }));
  const confirmation = within(screen.getByRole('alertdialog'));
  await user.click(confirmation.getByRole('button', { name: en.interactions.delete }));
  await screen.findByText(en.archive.emptyTitle);
  expect((await backend.load()).visits).toEqual([]);
});

it.each([false, true])(
  'keeps failed archive/restore retryable and prevents duplicate requests (archived: %s)',
  async (archived) => {
    const { backend, prototype, user } = await setup('cloud', archived);
    let reject!: (error: Error) => void;
    const failure = new Promise<void>((_resolve, no) => {
      reject = no;
    });
    const save = vi.spyOn(prototype, 'setCarArchived').mockReturnValueOnce(failure);
    // Archiving lives in Edit car; archived vehicles also offer Restore in their header.
    const scope = archived ? screen : await openEditCar(user);
    const button = await scope.findByRole('button', {
      name: archived ? en.archive.restore : en.archive.archive,
    });
    await user.dblClick(button);
    expect(save).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.textContent).toBe(archived ? en.archive.restoring : en.archive.archiving);
    await act(async () => reject(new TypeError('Failed to fetch')));
    await screen.findByText(en.errors.archive);
    expect((await backend.load()).cars[0].isArchived).toBe(archived);
    await user.click(button);
    await screen.findByText(archived ? en.interactions.carRestored : en.interactions.carArchived);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((await backend.load()).cars[0].isArchived).toBe(!archived);
  },
);
