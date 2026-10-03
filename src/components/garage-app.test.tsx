import * as React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, get } from 'idb-keyval';
import { createClient } from '@supabase/supabase-js';
import { account, fakeSupabase } from '../test/fake-supabase';
import { car, visit } from '../test/fixtures';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
let cloud: ReturnType<typeof fakeSupabase>;
beforeEach(async () => {
  await clear(); vi.resetModules(); vi.doMock('react', () => React);
  cloud = fakeSupabase();
  cloud.tables.set('vehicle_makes', new Map([
    ['toyota', { id: 'toyota', lookup_key: 'toyota', display_name: 'Toyota' }],
    ['honda', { id: 'honda', lookup_key: 'honda', display_name: 'Honda' }],
  ]));
  cloud.tables.set('vehicle_models', new Map([
    ['rav4', { id: 'rav4', make_id: 'toyota', lookup_key: 'rav4', display_name: 'RAV4' }],
    ['civic', { id: 'civic', make_id: 'honda', lookup_key: 'civic', display_name: 'Civic' }],
  ]));
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
    expect(dialog.queryAllByRole('combobox')).toHaveLength(configured ? 3 : 1); // Includes distance-unit select.
    expect((dialog.getByLabelText('Distance unit') as HTMLSelectElement).value).toBe('miles');
    expect((dialog.getByLabelText('Coming up: miles before due') as HTMLInputElement).value).toBe('500');
    await user.type(dialog.getByLabelText('Nickname'), 'Daily driver');
    await user.type(dialog.getByLabelText('Make'), 'Toyota');
    if (configured) await user.click(await dialog.findByRole('option', { name: 'Toyota' }));
    await user.type(dialog.getByLabelText('Model'), 'RAV4');
    if (configured) await user.click(await dialog.findByRole('option', { name: 'RAV4' }));
    await user.type(dialog.getByLabelText('Current odometer (miles)'), '100');
    await user.click(dialog.getByRole('button', { name: 'Add car' }));
    await screen.findByRole('tab', { name: 'Daily driver' });
    expect(screen.queryByText(/^Plate:/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Edit car' }));
    const edit = within(screen.getByRole('dialog', { name: 'Edit car' }));
    expect((edit.getByLabelText('Make') as HTMLInputElement).value).toBe('Toyota');
    expect((edit.getByLabelText('Model') as HTMLInputElement).value).toBe('RAV4');
    expect(edit.queryAllByRole('combobox')).toHaveLength(configured ? 2 : 0);
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
      if (configured) expect(cloud.from.mock.calls.every(([table]) => table.startsWith('vehicle_'))).toBe(true);
      else expect(cloud.from).not.toHaveBeenCalled();
      if (configured) expect(screen.getByText('Guest — stored in this browser')).toBeDefined();
      else expect(screen.getByText('Local prototype')).toBeDefined();
    }
    app.unmount();
    render(<GarageApp />);
    await screen.findByText('Updated driver');
    await user.click(screen.getAllByRole('button', { name: 'My cars' })[0]);
    await user.click(screen.getByRole('button', { name: 'Edit car' }));
    expect((screen.getByLabelText('Make') as HTMLInputElement).value).toBe('Toyota');
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('RAV4');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getAllByRole('button', { name: 'My cars' })[0]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Delete car and records' }));
    await screen.findByText('No cars yet');
    expect((await new LocalRepository().load()).cars).toEqual([]);
    expect(cloud.tables.get('cars')?.size ?? 0).toBe(0);
  });
});

it('preserves free text in add/edit, scopes models after make changes, and dismisses suggestions before the modal', async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://garage.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'test-key');
  const { GarageApp } = await import('./garage-app');
  const { LocalRepository } = await import('../lib/repository');
  render(<GarageApp />);
  const user = userEvent.setup();
  const opener = await screen.findByRole('button', { name: 'Add a car' });
  await user.click(opener);
  expect(document.activeElement).toBe(screen.getByLabelText('Nickname'));
  fireEvent.change(screen.getByLabelText('Nickname'), { target: { value: 'Unlisted' } });
  fireEvent.change(screen.getByLabelText('Current odometer (miles)'), { target: { value: '10' } });
  await user.type(screen.getByLabelText('Make'), 'Toyota');
  await screen.findByRole('option', { name: 'Toyota' });
  await user.keyboard('{ArrowDown}{Enter}');
  expect(screen.getByRole('dialog')).toBeDefined();
  await user.type(screen.getByLabelText('Model'), 'Custom model');
  await user.clear(screen.getByLabelText('Make'));
  await user.type(screen.getByLabelText('Make'), 'Honda');
  expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('Custom model');
  await user.keyboard('{Escape}');
  expect(screen.getByRole('dialog')).toBeDefined();
  await user.clear(screen.getByLabelText('Model'));
  await screen.findByRole('option', { name: 'Civic' });
  expect(screen.queryByRole('option', { name: 'RAV4' })).toBeNull();
  await user.type(screen.getByLabelText('Model'), ' RAV4 '); // Deliberately arbitrary Honda/model pair.
  await user.click(screen.getByRole('button', { name: 'Add car' }));
  await screen.findByRole('tab', { name: 'Unlisted' });
  expect((await new LocalRepository().load()).cars[0]).toMatchObject({ make: 'Honda', model: 'RAV4' });
  await user.click(screen.getByRole('button', { name: 'Edit car' }));
  expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('RAV4');
  await user.clear(screen.getByLabelText('Make'));
  await user.type(screen.getByLabelText('Make'), ' Unknown maker ');
  expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('RAV4');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect((await new LocalRepository().load()).cars[0]).toMatchObject({ make: 'Unknown maker', model: 'RAV4' });
  await user.click(screen.getByRole('button', { name: 'Edit car' }));
  await user.click(screen.getByLabelText('Make'));
  expect(screen.queryByRole('listbox')).toBeNull();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('a catalog outage allows guest save and a later retry without altering saved edit values', async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://garage.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'test-key');
  cloud.execute.mockRejectedValueOnce(new Error('catalog offline'));
  const { GarageApp } = await import('./garage-app');
  const { LocalRepository } = await import('../lib/repository');
  render(<GarageApp />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Add a car' }));
  await screen.findByText('Suggestions unavailable. You can still type any value.');
  for (const [label, value] of [['Nickname', 'Free text'], ['Make', 'unknown'], ['Model', 'existing custom'], ['Current odometer (miles)', '1']]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  await user.click(screen.getByRole('button', { name: 'Add car' }));
  await screen.findByRole('tab', { name: 'Free text' });
  expect((await new LocalRepository().load()).cars[0]).toMatchObject({ make: 'unknown', model: 'existing custom' });
  cloud.execute.mockRejectedValueOnce(new Error('catalog still offline'));
  await user.click(screen.getByRole('button', { name: 'Edit car' }));
  await screen.findByText('Suggestions unavailable. You can still type any value.');
  await user.click(screen.getByRole('button', { name: 'Retry make suggestions' }));
  await waitFor(() => expect(screen.queryByText('Suggestions unavailable. You can still type any value.')).toBeNull());
  await waitFor(() => expect(screen.queryByText('Loading suggestions. You can still type.')).toBeNull());
  expect((screen.getByLabelText('Make') as HTMLInputElement).value).toBe('unknown');
  expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('existing custom');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

describe.each([['guest', false], ['authenticated cloud', true]] as const)('%s plate workflow', (_mode, authenticated) => {
  it('creates, edits, clears, and reloads a plate while preserving unrelated fields', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://garage.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'test-key');
    if (authenticated) cloud.emit(account());
    const { GarageApp } = await import('./garage-app');
    const { createRepository } = await import('../lib/repository');
    const repository = createRepository(authenticated ? account().id : undefined);
    let app = render(<GarageApp />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add a car' }));
    let dialog = within(screen.getByRole('dialog', { name: 'Add a car' }));
    for (const [label, value] of [['Nickname', 'Plate driver'], ['Make', 'Toyota'], ['Model', 'RAV4'], ['Current odometer (miles)', '100'], ['Coming up: days before due', '15'], ['Coming up: miles before due', '123']]) {
      fireEvent.change(dialog.getByLabelText(label), { target: { value } });
    }
    const vin = dialog.getByLabelText(/VIN/);
    await user.type(vin, '12345678901234567');
    await user.tab();
    const plateInput = dialog.getByLabelText(/License plate/);
    expect(document.activeElement).toBe(plateInput);
    await user.type(plateInput, '  AbC  - 123  ');
    await user.click(dialog.getByRole('button', { name: 'Add car' }));
    await screen.findByRole('tab', { name: 'Plate driver' });
    expect(screen.getByText('Plate: AbC - 123').textContent).toBe('Plate: AbC  - 123');
    const created = (await repository.load()).cars[0];
    expect(created).toMatchObject({ plate: 'AbC  - 123', vin: '12345678901234567', reminderDays: 15, reminderMiles: 123 });

    await user.click(screen.getByRole('button', { name: 'Edit car' }));
    dialog = within(screen.getByRole('dialog', { name: 'Edit car' }));
    expect((dialog.getByLabelText(/License plate/) as HTMLInputElement).value).toBe(created.plate);
    fireEvent.change(dialog.getByLabelText(/License plate/), { target: { value: 'W'.repeat(21) } });
    await user.click(dialog.getByRole('button', { name: 'Save changes' }));
    expect(await dialog.findByRole('alert')).toHaveProperty('textContent', 'License plate must be 20 characters or fewer.');
    expect((await repository.load()).cars[0]).toEqual(created);
    fireEvent.change(dialog.getByLabelText(/License plate/), { target: { value: `  ${'W'.repeat(20)}  ` } });
    await user.click(dialog.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await repository.load()).cars[0]).toEqual({ ...created, plate: 'W'.repeat(20) });

    app.unmount(); app = render(<GarageApp />);
    await screen.findByText('Plate driver');
    await user.click(screen.getAllByRole('button', { name: 'My cars' })[0]);
    expect(screen.getByText(`Plate: ${'W'.repeat(20)}`)).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Edit car' }));
    dialog = within(screen.getByRole('dialog', { name: 'Edit car' }));
    expect((dialog.getByLabelText(/License plate/) as HTMLInputElement).value).toBe('W'.repeat(20));
    await user.clear(dialog.getByLabelText(/License plate/));
    await user.click(dialog.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText(/^Plate:/)).toBeNull();
    expect((await repository.load()).cars[0]).toEqual({ ...created, plate: '' });
    app.unmount(); render(<GarageApp />);
    await screen.findByText('Plate driver');
    await user.click(screen.getAllByRole('button', { name: 'My cars' })[0]);
    expect(screen.queryByText(/^Plate:/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Edit car' }));
    expect((screen.getByLabelText(/License plate/) as HTMLInputElement).value).toBe('');
  });
});

it('switches creation defaults while preserving typed odometer readings and customized reminder windows', async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
  const { GarageApp } = await import('./garage-app');
  render(<GarageApp />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Add a car' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Add a car' }));
  fireEvent.change(dialog.getByLabelText('Current odometer (miles)'), { target: { value: '12345' } });
  await user.selectOptions(dialog.getByLabelText('Distance unit'), 'kilometers');
  expect((dialog.getByLabelText('Coming up: kilometers before due') as HTMLInputElement).value).toBe('1000');
  expect((dialog.getByLabelText('Current odometer (kilometers)') as HTMLInputElement).value).toBe('12345');
  await user.selectOptions(dialog.getByLabelText('Distance unit'), 'miles');
  expect((dialog.getByLabelText('Coming up: miles before due') as HTMLInputElement).value).toBe('500');
  fireEvent.change(dialog.getByLabelText('Coming up: miles before due'), { target: { value: '0' } });
  await user.selectOptions(dialog.getByLabelText('Distance unit'), 'kilometers');
  expect((dialog.getByLabelText('Coming up: kilometers before due') as HTMLInputElement).value).toBe('0');
  fireEvent.change(dialog.getByLabelText('Coming up: kilometers before due'), { target: { value: '750' } });
  await user.selectOptions(dialog.getByLabelText('Distance unit'), 'miles');
  expect((dialog.getByLabelText('Coming up: miles before due') as HTMLInputElement).value).toBe('750');
});

describe.each([['guest', false], ['cloud', true]] as const)('%s kilometer workflow', (_mode, authenticated) => {
  it('persists the unit, cascades it to tasks and visits, and keeps it read-only after reload', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', authenticated ? 'https://garage.supabase.co' : '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', authenticated ? 'test-key' : '');
    if (authenticated) cloud.emit(account());
    const { GarageApp } = await import('./garage-app');
    const app = render(<GarageApp />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add a car' }));
    let dialog = within(screen.getByRole('dialog', { name: 'Add a car' }));
    for (const [label, value] of [['Nickname', 'Metric driver'], ['Make', 'Toyota'], ['Model', 'RAV4'], ['Current odometer (miles)', '100']]) {
      fireEvent.change(dialog.getByLabelText(label), { target: { value } });
    }
    await user.selectOptions(dialog.getByLabelText('Distance unit'), 'kilometers');
    await user.click(dialog.getByRole('button', { name: 'Add car' }));
    await screen.findByRole('tab', { name: 'Metric driver' });
    expect(screen.getByText(/100 km current odometer/)).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Add task' }));
    dialog = within(screen.getByRole('dialog', { name: 'Add maintenance task' }));
    fireEvent.change(dialog.getByLabelText('Task name'), { target: { value: 'Brake check' } });
    fireEvent.change(dialog.getByLabelText(/First due at odometer \(kilometers\)/), { target: { value: '1100' } });
    fireEvent.change(dialog.getByLabelText(/Repeat every kilometers/), { target: { value: '5000' } });
    await user.click(dialog.getByRole('button', { name: 'Save task' }));
    await screen.findByText('at 1,100 km');
    expect(screen.getByText('Soon')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Log service' }));
    dialog = within(screen.getByRole('dialog', { name: 'Log service' }));
    expect((dialog.getByLabelText('Odometer (kilometers)') as HTMLInputElement).value).toBe('100');
    fireEvent.change(dialog.getByLabelText('Odometer (kilometers)'), { target: { value: '1200' } });
    fireEvent.change(dialog.getByLabelText('Total cost (USD)'), { target: { value: '50' } });
    const taskOption = dialog.getByRole('option', { name: 'Brake check' }) as HTMLOptionElement;
    await user.selectOptions(dialog.getByLabelText('Choose scheduled task'), taskOption.value);
    await user.click(dialog.getByRole('button', { name: 'Save visit' }));
    await screen.findByText('at 6,200 km');
    expect(screen.getByText('Later')).toBeDefined();
    expect(screen.getByText(/1,200 km current odometer/)).toBeDefined();
    const { createRepository } = await import('../lib/repository');
    const saved = await createRepository(authenticated ? account().id : undefined).load();
    expect(saved.cars[0]).toMatchObject({ distanceUnit: 'kilometers', reminderMiles: 1000, odometer: 100 });
    expect(saved.schedules.find((item) => item.name === 'Brake check')).toMatchObject({ intervalMiles: 5000, firstDueMiles: 1100 });
    expect(saved.visits[0].odometer).toBe(1200);
    app.unmount();
    render(<GarageApp />);
    await screen.findByText('Metric driver');
    await user.click(screen.getAllByRole('button', { name: 'My cars' })[0]);
    await user.click(screen.getByRole('button', { name: 'Edit car' }));
    dialog = within(screen.getByRole('dialog', { name: 'Edit car' }));
    const unit = dialog.getByLabelText('Distance unit') as HTMLInputElement;
    expect(unit.value).toBe('Kilometers'); expect(unit.readOnly).toBe(true);
    expect((dialog.getByLabelText('Coming up: kilometers before due') as HTMLInputElement).value).toBe('1000');
    fireEvent.change(dialog.getByLabelText('Coming up: kilometers before due'), { target: { value: '250' } });
    await user.click(dialog.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await createRepository(authenticated ? account().id : undefined).load()).cars[0]).toMatchObject({ distanceUnit: 'kilometers', reminderMiles: 250 });
  });
});

it('sorts mixed-unit history by equivalent distance and refreshes a new visit reading when switching vehicles', async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
  const { LocalRepository } = await import('../lib/repository');
  const local = new LocalRepository();
  await local.saveCar(car);
  await local.saveCar({ ...car, id: 'metric', name: 'Metric driver', distanceUnit: 'kilometers', reminderMiles: 1000 });
  await local.saveVisit({ ...visit, odometer: 1000 });
  await local.saveVisit({ ...visit, id: 'metric-visit', carId: 'metric', odometer: 1600 });
  const { GarageApp } = await import('./garage-app');
  render(<GarageApp />);
  const user = userEvent.setup();
  await user.click((await screen.findAllByRole('button', { name: 'Service history' }))[0]);
  await user.selectOptions(screen.getByLabelText('Sort service history'), 'odometer_high');
  const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
  expect(rows[0].textContent).toContain('1,000 mi');
  expect(rows[1].textContent).toContain('1,600 km');
  await user.click(screen.getByRole('button', { name: 'Log service' }));
  const dialog = within(screen.getByRole('dialog', { name: 'Log service' }));
  expect((dialog.getByLabelText('Odometer (miles)') as HTMLInputElement).value).toBe('1000');
  fireEvent.change(dialog.getByLabelText('Odometer (miles)'), { target: { value: '99' } });
  await user.selectOptions(dialog.getByLabelText('Vehicle'), 'metric');
  expect((dialog.getByLabelText('Odometer (kilometers)') as HTMLInputElement).value).toBe('1600');
  await user.selectOptions(dialog.getByLabelText('Vehicle'), car.id);
  expect((dialog.getByLabelText('Odometer (miles)') as HTMLInputElement).value).toBe('1000');
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
