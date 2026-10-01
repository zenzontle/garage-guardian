import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, get } from 'idb-keyval';
import { createClient } from '@supabase/supabase-js';
import { account, fakeSupabase } from '../test/fake-supabase';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
let cloud: ReturnType<typeof fakeSupabase>;
beforeEach(async () => {
  await clear(); vi.resetModules(); vi.doMock('react', () => React);
  cloud = fakeSupabase();
  vi.mocked(createClient).mockReturnValue(cloud.client as unknown as ReturnType<typeof createClient>);
});

describe.each([
  ['local prototype', false, false],
  ['configured guest', true, false],
  ['authenticated cloud', true, true],
] as const)('%s application access', (_mode, configured, authenticated) => {
  it('opens the app, saves and edits a car, survives reload, and deletes it', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', configured ? 'https://garage.supabase.co' : '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', configured ? 'test-key' : '');
    if (authenticated) cloud.emit(account());
    const { GarageApp } = await import('./garage-app');
    const { LocalRepository } = await import('../lib/repository');
    const app = render(<GarageApp />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add a car' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Add a car' }));
    await user.type(dialog.getByLabelText('Nickname'), 'Daily driver');
    await user.type(dialog.getByLabelText('Make'), 'Toyota');
    await user.type(dialog.getByLabelText('Model'), 'RAV4');
    await user.type(dialog.getByLabelText('Current odometer (miles)'), '100');
    await user.click(dialog.getByRole('button', { name: 'Add car' }));
    await screen.findByRole('tab', { name: 'Daily driver' });
    await user.click(screen.getByRole('button', { name: 'Edit car' }));
    const edit = within(screen.getByRole('dialog', { name: 'Edit car' }));
    await user.clear(edit.getByLabelText('Nickname'));
    await user.type(edit.getByLabelText('Nickname'), 'Updated driver');
    await user.click(edit.getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('tab', { name: 'Updated driver' });
    const local = await new LocalRepository().load();
    if (authenticated) {
      expect(local.cars).toEqual([]);
      expect(await get('garage-guardian:local:v1')).toBeUndefined();
      expect([...cloud.tables.get('cars')!.values()][0].name).toBe('Updated driver');
      expect([...cloud.tables.get('schedule_items')!.values()]).toHaveLength(6);
      expect(screen.getAllByText('Stored in Supabase')).toHaveLength(2);
    } else {
      expect(local.cars[0].name).toBe('Updated driver');
      expect(local.schedules).toHaveLength(6);
      expect(cloud.from).not.toHaveBeenCalled();
      if (configured) expect(screen.getByText('Guest — stored in this browser')).toBeDefined();
      else expect(screen.getByText('Local prototype')).toBeDefined();
    }
    app.unmount();
    render(<GarageApp />);
    await screen.findByText('Updated driver');
    await user.click(screen.getAllByRole('button', { name: 'My cars' })[0]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Delete car and records' }));
    await screen.findByText('No cars yet');
    expect((await new LocalRepository().load()).cars).toEqual([]);
    expect(cloud.tables.get('cars')?.size ?? 0).toBe(0);
  });
});

it('lets guests leave the auth form and shows confirmation-pending signup feedback', async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://garage.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'test-key');
  cloud.requireConfirmation();
  const { GarageApp } = await import('./garage-app');
  render(<GarageApp />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Sign in' }));
  await user.click(screen.getByRole('button', { name: 'Continue without an account' }));
  expect(screen.getByRole('button', { name: 'Add a car' })).toBeDefined();
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await user.type(screen.getByLabelText('Email'), 'new@example.com');
  await user.type(screen.getByLabelText('Password'), 'password');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByText(/Check your email to confirm/);
  expect(cloud.from).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Add a car' })).toBeDefined();
});

it('offers retry and sign-out after an authenticated cloud load failure', async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://garage.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'test-key');
  cloud.emit(account());
  cloud.execute.mockResolvedValueOnce({ data: null, error: new Error('Cloud unavailable') });
  const { GarageApp } = await import('./garage-app');
  render(<GarageApp />);
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'Add a car' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Add a car' })).toBeDefined());
});
