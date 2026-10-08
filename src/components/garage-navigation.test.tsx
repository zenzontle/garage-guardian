import { loadGarageTestApp, testRouter } from '../test/garage-router';
import * as React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { clear } from 'idb-keyval';
import { createClient } from '@supabase/supabase-js';
import { car } from '../test/fixtures';
import { account, fakeSupabase } from '../test/fake-supabase';
import { accountPath, carPath } from '../lib/garage-routes';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
let cloud: ReturnType<typeof fakeSupabase>;
beforeEach(async () => {
  testRouter.reset();
  localStorage.clear();
  await clear();
  vi.resetModules();
  vi.doMock('react', () => React);
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
  cloud = fakeSupabase();
  vi.mocked(createClient).mockReturnValue(
    cloud.client as unknown as ReturnType<typeof createClient>,
  );
});

async function seed() {
  const { LocalRepository } = await import('../lib/repository');
  const local = new LocalRepository();
  await local.saveCar(car);
  await local.saveCar({ ...car, id: 'second', name: 'Second vehicle' });
  return { local, LocalRepository };
}
function configureCloud() {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://garage.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'test-key');
}

it('retraces screens and vehicles with Back/Forward without reloading the garage, and restores a bookmark', async () => {
  const { LocalRepository } = await seed();
  const loads = vi.spyOn(LocalRepository.prototype, 'load');
  const App = await loadGarageTestApp();
  const app = render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('link', { name: /Daily driver/ }));
  expect(testRouter.url).toBe(carPath(car.id));
  await user.click(screen.getByRole('link', { name: 'Second vehicle' }));
  expect(testRouter.url).toBe('/cars/second');
  expect(screen.getByRole('link', { name: 'Second vehicle' }).getAttribute('aria-current')).toBe(
    'page',
  );
  await user.click(
    within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', {
      name: 'Service history',
    }),
  );
  expect(testRouter.url).toBe('/history');
  expect(
    within(screen.getByRole('navigation', { name: 'Mobile navigation' }))
      .getByRole('link', { name: 'History' })
      .getAttribute('aria-current'),
  ).toBe('page');
  act(() => testRouter.back());
  expect(screen.getByRole('heading', { name: 'Second vehicle' })).toBeDefined();
  act(() => testRouter.back());
  expect(screen.getByRole('heading', { name: 'Daily driver' })).toBeDefined();
  act(() => testRouter.forward());
  expect(screen.getByRole('heading', { name: 'Second vehicle' })).toBeDefined();
  expect(loads).toHaveBeenCalledOnce();
  app.unmount();
  render(<App />);
  await screen.findByRole('heading', { name: 'Second vehicle' });
  expect(testRouter.url).toBe('/cars/second');
});

it.each([
  ['/history', 'Service history'],
  ['/reports', 'Reports'],
])('loads and reloads %s directly', async (url, title) => {
  testRouter.reset(url);
  const App = await loadGarageTestApp();
  const app = render(<App />);
  await screen.findByRole('heading', { name: title });
  app.unmount();
  render(<App />);
  await screen.findByRole('heading', { name: title });
  expect(testRouter.url).toBe(url);
});

it('waits for garage loading before canonicalizing /cars and leaves no extra Back stop', async () => {
  const { LocalRepository } = await seed();
  const original = LocalRepository.prototype.load;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(LocalRepository.prototype, 'load').mockImplementationOnce(async function (
    this: InstanceType<typeof LocalRepository>,
  ) {
    await gate;
    return original.call(this);
  });
  testRouter.reset('/cars');
  const App = await loadGarageTestApp();
  render(<App />);
  await screen.findByRole('heading', { name: 'Opening your garage' });
  expect(testRouter.url).toBe('/cars');
  expect(testRouter.replace).not.toHaveBeenCalled();
  release();
  await screen.findByRole('heading', { name: car.name });
  expect(testRouter.entries).toEqual([carPath(car.id)]);
});

it('keeps an empty Vehicles URL and shows missing bookmarks without substituting a car', async () => {
  testRouter.reset('/cars');
  const App = await loadGarageTestApp();
  const app = render(<App />);
  await screen.findByText('No cars yet');
  expect(testRouter.url).toBe('/cars');
  app.unmount();
  await seed();
  testRouter.reset('/cars/missing');
  localStorage.setItem('garage-guardian:locale', 'es');
  render(<App />);
  await screen.findByText('Auto no disponible');
  expect(testRouter.url).toBe('/cars/missing');
  expect(screen.queryByRole('heading', { name: car.name })).toBeNull();
  expect(testRouter.replace).not.toHaveBeenCalled();
});

it('closes dialogs and the mobile menu on browser navigation', async () => {
  await seed();
  const App = await loadGarageTestApp();
  const app = render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Open menu' }));
  await user.click(screen.getByRole('button', { name: 'Add another car' }));
  expect(screen.getByRole('dialog')).toBeDefined();
  act(() => testRouter.push('/reports'));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(app.container.querySelector('.sidebar.open')).toBeNull();
  act(() => testRouter.back());
  expect(screen.queryByRole('dialog')).toBeNull();
});

it.each(['/', '/cars', '/history', '/reports'])(
  'closes the mobile drawer when its active link is selected at %s',
  async (url) => {
    testRouter.reset(url);
    const App = await loadGarageTestApp();
    const app = render(<App />);
    const user = userEvent.setup();
    const menu = await screen.findByRole('button', { name: 'Open menu' });
    const activeLink = within(screen.getByRole('navigation', { name: 'Main navigation' }))
      .getAllByRole('link')
      .find((link) => link.getAttribute('aria-current') === 'page')!;

    await user.click(menu);
    expect(app.container.querySelector('.sidebar.open')).not.toBeNull();
    await user.click(activeLink);
    expect(app.container.querySelector('.sidebar.open')).toBeNull();
    expect(testRouter.url).toBe(url);

    await user.click(menu);
    activeLink.focus();
    await user.keyboard('{Enter}');
    expect(app.container.querySelector('.sidebar.open')).toBeNull();
    expect(testRouter.url).toBe(url);
  },
);

it('retains a vehicle after failed edit/delete, and replaces the URL only after successful deletion', async () => {
  const { LocalRepository } = await seed();
  testRouter.reset(carPath(car.id));
  const App = await loadGarageTestApp();
  render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Edit car' }));
  vi.spyOn(LocalRepository.prototype, 'saveCar').mockRejectedValueOnce(new Error('failed save'));
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await within(screen.getByRole('dialog')).findByRole('alert');
  expect(testRouter.url).toBe(carPath(car.id));
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(LocalRepository.prototype, 'deleteCar').mockRejectedValueOnce(
    new Error('failed delete'),
  );
  await user.click(screen.getByRole('button', { name: 'Delete car and records' }));
  await screen.findByRole('alert');
  expect(testRouter.url).toBe(carPath(car.id));
  expect(screen.getByRole('heading', { name: car.name })).toBeDefined();
  await user.click(screen.getByRole('button', { name: 'Delete car and records' }));
  await screen.findByRole('heading', { name: 'Second vehicle' });
  expect(testRouter.entries).toEqual(['/cars/second']);
  await user.click(screen.getByRole('button', { name: 'Delete car and records' }));
  await screen.findByText('No cars yet');
  expect(testRouter.entries).toEqual(['/cars']);
});

it.each([false, true])(
  'retains the vehicle URL after a committed delete fails to refresh (only car=%s)',
  async (onlyCar) => {
    const { local, LocalRepository } = await seed();
    if (onlyCar) await local.deleteCar('second');
    testRouter.reset(carPath(car.id));
    const App = await loadGarageTestApp();
    render(<App />);
    await screen.findByRole('heading', { name: car.name });
    const load = vi.spyOn(LocalRepository.prototype, 'load');
    const original = LocalRepository.prototype.deleteCar;
    const remove = vi
      .spyOn(LocalRepository.prototype, 'deleteCar')
      .mockImplementationOnce(async function (this: InstanceType<typeof LocalRepository>, id) {
        await original.call(this, id);
        load.mockRejectedValueOnce(new Error('Refresh failed'));
      });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete car and records' }));
    await screen.findByRole('alert');
    expect(testRouter.url).toBe(carPath(car.id));
    expect(testRouter.replace).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: car.name })).toBeDefined();
    expect((await local.load()).cars.map((entry) => entry.id)).toEqual(onlyCar ? [] : ['second']);
    await user.click(screen.getByRole('button', { name: 'Retry refresh' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(remove).toHaveBeenCalledOnce();
    expect(testRouter.replace).not.toHaveBeenCalled();
  },
);

it('returns from account screens to a bookmark, preserves email between modes and clears password/error', async () => {
  configureCloud();
  await seed();
  testRouter.reset('/cars/second');
  const App = await loadGarageTestApp();
  render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('link', { name: 'Sign in' }));
  expect(testRouter.url).toBe(accountPath('signin', '/cars/second'));
  await user.type(screen.getByLabelText('Email'), 'me@example.com');
  await user.type(screen.getByLabelText('Password'), 'password');
  cloud.auth.signInWithPassword.mockRejectedValueOnce({ code: 'invalid_credentials' });
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('alert');
  await user.click(screen.getByRole('button', { name: 'Create an account' }));
  expect(testRouter.url).toBe(accountPath('signup', '/cars/second'));
  expect(screen.getByLabelText('Email')).toHaveProperty('value', 'me@example.com');
  expect(screen.getByLabelText('Password')).toHaveProperty('value', '');
  expect(screen.queryByRole('alert')).toBeNull();
  expect(testRouter.entries).toEqual(['/cars/second', accountPath('signup', '/cars/second')]);
  await user.click(screen.getByRole('button', { name: 'Already have an account? Sign in' }));
  await user.click(screen.getByRole('button', { name: 'Create an account' }));
  expect(testRouter.entries).toEqual(['/cars/second', accountPath('signup', '/cars/second')]);
  await user.click(screen.getByRole('button', { name: 'Continue without an account' }));
  expect(testRouter.url).toBe('/cars/second');
  expect(screen.getByRole('heading', { name: 'Second vehicle' })).toBeDefined();
  act(() => testRouter.back());
  expect(testRouter.url).toBe('/cars/second');
  expect(screen.queryByLabelText('Password')).toBeNull();
});

it('signs in to the original screen, retains it on sign-out, and offers sign-in for unavailable cloud bookmarks', async () => {
  configureCloud();
  testRouter.reset('/cars/private');
  const App = await loadGarageTestApp();
  render(<App />);
  const user = userEvent.setup();
  await screen.findByText('Vehicle unavailable');
  await user.click(screen.getAllByRole('link', { name: 'Sign in' })[0]);
  await user.click(screen.getByRole('button', { name: 'Create an account' }));
  await user.click(screen.getByRole('button', { name: 'Already have an account? Sign in' }));
  await user.type(await screen.findByLabelText('Email'), 'me@example.com');
  await user.type(screen.getByLabelText('Password'), 'password');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByText('Vehicle unavailable');
  expect(testRouter.url).toBe('/cars/private');
  expect(testRouter.entries).toEqual(['/cars/private', '/cars/private']);
  act(() => testRouter.back());
  expect(testRouter.url).toBe('/cars/private');
  expect(screen.queryByLabelText('Password')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Sign out' }));
  await screen.findByText('Vehicle unavailable');
  expect(testRouter.url).toBe('/cars/private');
  expect(
    screen
      .getAllByRole('link', { name: 'Sign in' })
      .every((link) => link.getAttribute('href') === accountPath('signin', '/cars/private')),
  ).toBe(true);
});

it.each([false, true])(
  'bypasses account screens for prototype or signed-in users (cloud=%s)',
  async (configured) => {
    if (configured) {
      configureCloud();
      cloud.emit(account());
    }
    testRouter.reset(accountPath('signup', '/reports'));
    const App = await loadGarageTestApp();
    render(<App />);
    await waitFor(() => expect(testRouter.url).toBe('/reports'));
    expect(screen.queryByLabelText('Password')).toBeNull();
  },
);

it('keeps deep URLs through cloud recovery and retry', async () => {
  configureCloud();
  cloud.emit(account());
  cloud.execute.mockResolvedValueOnce({ data: null, error: new Error('offline') });
  testRouter.reset('/history');
  const App = await loadGarageTestApp();
  render(<App />);
  await screen.findByRole('alert');
  expect(testRouter.url).toBe('/history');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('heading', { name: 'Service history' });
  expect(testRouter.url).toBe('/history');
});

it('returns confirmation-pending signup to the original screen and keeps its notice', async () => {
  configureCloud();
  cloud.requireConfirmation();
  testRouter.reset(accountPath('signup', '/reports'));
  const App = await loadGarageTestApp();
  render(<App />);
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Email'), 'new@example.com');
  await user.type(screen.getByLabelText('Password'), 'password');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByText(/Check your email to confirm/);
  expect(testRouter.url).toBe('/reports');
  expect(screen.getByRole('heading', { name: 'Reports' })).toBeDefined();
});

it('reloads a direct sign-in route and sends an invalid return destination to Dashboard', async () => {
  configureCloud();
  testRouter.reset('/signin?returnTo=https%3A%2F%2Fevil.test');
  const App = await loadGarageTestApp();
  const app = render(<App />);
  await screen.findByLabelText('Email');
  app.unmount();
  render(<App />);
  await screen.findByLabelText('Email');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Continue without an account' }));
  expect(testRouter.url).toBe('/');
});

it('does not redirect away from a new screen when a vehicle deletion finishes', async () => {
  const { LocalRepository } = await seed();
  const original = LocalRepository.prototype.deleteCar;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(LocalRepository.prototype, 'deleteCar').mockImplementationOnce(async function (
    this: InstanceType<typeof LocalRepository>,
    id,
  ) {
    await gate;
    return original.call(this, id);
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  testRouter.reset(carPath(car.id));
  const App = await loadGarageTestApp();
  render(<App />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Delete car and records' }));
  act(() => testRouter.push('/reports'));
  release();
  await waitFor(() => expect(screen.getByText('1 vehicle')).toBeDefined());
  expect(testRouter.url).toBe('/reports');
  expect(testRouter.replace).not.toHaveBeenCalled();
});

it('keeps the requested vehicle and does not restart a signup transfer on navigation', async () => {
  configureCloud();
  await seed();
  const { registerSignup } = await import('../lib/signup-transfer');
  await registerSignup('https://garage.supabase.co', account(), true);
  cloud.emit(account());
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = cloud.execute.getMockImplementation()!;
  cloud.execute.mockImplementationOnce(async (...args) => {
    await gate;
    return original(...args);
  });
  const App = await loadGarageTestApp();
  render(<App />);
  await screen.findByRole('heading', { name: 'Moving your garage to Supabase' });
  await waitFor(() => expect(cloud.execute).toHaveBeenCalledOnce());
  act(() => testRouter.push('/cars/second'));
  expect(cloud.execute).toHaveBeenCalledOnce();
  release();
  await screen.findByRole('heading', { name: 'Second vehicle' });
  expect(testRouter.url).toBe('/cars/second');
});
