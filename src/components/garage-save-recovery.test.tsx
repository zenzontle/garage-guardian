import { loadGarageTestApp, testRouter } from '../test/garage-router';
import * as React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, get } from 'idb-keyval';
import { createClient } from '@supabase/supabase-js';
import { account, fakeSupabase } from '../test/fake-supabase';
import { car, visit } from '../test/fixtures';
import type { Repository } from '../lib/repository';

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('../lib/resize-photo', () => ({ resizePhoto: async (file: File) => file }));
let cloud: ReturnType<typeof fakeSupabase>;

beforeEach(async () => {
  testRouter.reset('/history');
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

async function setup(mode: 'local' | 'cloud') {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', mode === 'cloud' ? 'https://garage.supabase.co' : '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', mode === 'cloud' ? 'test-key' : '');
  if (mode === 'cloud') cloud.emit(account());
  const { createRepository, LocalRepository, SupabaseRepository } =
    await import('../lib/repository');
  const backend = createRepository(mode === 'cloud' ? account().id : undefined);
  await backend.saveCar(car);
  const GarageApp = await loadGarageTestApp();
  const app = render(<GarageApp />);
  await screen.findByRole('button', { name: 'Log service' });
  const prototype = mode === 'cloud' ? SupabaseRepository.prototype : LocalRepository.prototype;
  return { backend, prototype, app, user: userEvent.setup() };
}

async function openVisit(user: ReturnType<typeof userEvent.setup>, files = 1) {
  await user.click(screen.getByRole('button', { name: 'Log service' }));
  const dialogElement = screen.getByRole('dialog');
  const dialog = within(dialogElement);
  fireEvent.change(dialog.getByRole('textbox', { name: 'Service item name' }), {
    target: { value: 'Saved service' },
  });
  fireEvent.change(dialog.getByRole('spinbutton', { name: 'Total cost (USD)' }), {
    target: { value: '100' },
  });
  fireEvent.change(dialogElement.querySelector('input[type="file"]')!, {
    target: {
      files: Array.from(
        { length: files },
        (_, index) => new File(['receipt'], `receipt-${index}.webp`, { type: 'image/webp' }),
      ),
    },
  });
  await dialog.findByText('receipt-0.webp');
  return dialog;
}

describe.each(['local', 'cloud'] as const)('%s save recovery', (mode) => {
  it('keeps committed photos after refresh failure and offers a translated read-only retry', async () => {
    const { backend, prototype, user } = await setup(mode);
    const load = vi.spyOn(prototype, 'load');
    const originalSave = prototype.saveVisit;
    const save = vi.spyOn(prototype, 'saveVisit').mockImplementationOnce(async function (
      this: Repository,
      value,
    ) {
      await originalSave.call(this, value);
      load.mockRejectedValueOnce(new Error('Refresh failed'));
    });
    const upload = vi.spyOn(prototype, 'uploadPhoto');
    const remove = vi.spyOn(prototype, 'removePhoto');
    const dialog = await openVisit(user);
    await user.click(dialog.getByRole('button', { name: 'Save visit' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('alert').textContent).toContain(
      'Your changes were saved, but the garage could not refresh.',
    );
    expect(screen.queryByRole('button', { name: 'Saved service' })).toBeNull();
    const saved = (await backend.load()).visits;
    expect(saved).toHaveLength(1);
    expect(saved[0].photos).toHaveLength(1);
    if (mode === 'local')
      expect(await get(`photo:${saved[0].photos[0].path}`)).toBeInstanceOf(Blob);
    else expect(cloud.photos.has(saved[0].photos[0].path)).toBe(true);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'es');
    expect(screen.getByRole('alert').textContent).toContain(
      'Tus cambios se guardaron, pero no se pudo actualizar el garaje.',
    );
    load.mockRejectedValueOnce(new Error('Retry failed'));
    await user.click(screen.getByRole('button', { name: 'Reintentar actualización' }));
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Reintentar actualización',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(screen.queryByRole('button', { name: 'Saved service' })).toBeNull();
    load.mockRestore();
    const realLoad = prototype.load;
    let release!: () => void;
    vi.spyOn(prototype, 'load').mockImplementationOnce(async function (this: Repository) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return realLoad.call(this);
    });
    await user.click(screen.getByRole('button', { name: 'Reintentar actualización' }));
    expect(
      (screen.getByRole('button', { name: 'Reintentar actualización' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByRole('alert').getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      release();
    });
    await within(await screen.findByRole('table')).findByRole('button', { name: 'Saved service' });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(save).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
    expect((await backend.load()).visits).toEqual(saved);
  }, 15000);

  it('keeps a failed-save draft and removes only its new uploads, then allows saving again', async () => {
    const { backend, prototype, user } = await setup(mode);
    const save = vi.spyOn(prototype, 'saveVisit').mockRejectedValueOnce(new Error('Save failed'));
    const remove = vi.spyOn(prototype, 'removePhoto');
    const dialog = await openVisit(user);
    await user.click(dialog.getByRole('button', { name: 'Save visit' }));
    await dialog.findByRole('alert');
    expect(screen.queryByRole('button', { name: 'Retry refresh' })).toBeNull();
    expect((await backend.load()).visits).toEqual([]);
    expect(remove).toHaveBeenCalledOnce();
    const uploaded = remove.mock.calls[0][0];
    if (mode === 'local') expect(await get(`photo:${uploaded.path}`)).toBeUndefined();
    else expect(cloud.photos.has(uploaded.path)).toBe(false);
    expect(
      (dialog.getByRole('textbox', { name: 'Service item name' }) as HTMLInputElement).value,
    ).toBe('Saved service');
    await user.click(dialog.getByRole('button', { name: 'Save visit' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(save).toHaveBeenCalledTimes(2);
    expect((await backend.load()).visits).toHaveLength(1);
  });

  it('cleans up earlier uploads when a later upload fails without saving', async () => {
    const { backend, prototype, user } = await setup(mode);
    const originalUpload = prototype.uploadPhoto;
    vi.spyOn(prototype, 'uploadPhoto')
      .mockImplementationOnce(originalUpload)
      .mockRejectedValueOnce(new Error('Second upload failed'));
    const save = vi.spyOn(prototype, 'saveVisit');
    const remove = vi.spyOn(prototype, 'removePhoto');
    const dialog = await openVisit(user, 2);
    await dialog.findByText('receipt-1.webp');
    await user.click(dialog.getByRole('button', { name: 'Save visit' }));
    await dialog.findByRole('alert');
    expect(save).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledOnce();
    expect((await backend.load()).visits).toEqual([]);
    const photo = remove.mock.calls[0][0];
    if (mode === 'local') expect(await get(`photo:${photo.path}`)).toBeUndefined();
    else expect(cloud.photos.has(photo.path)).toBe(false);
  });

  it('closes an edited visit when old-photo cleanup fails and preserves its new photos', async () => {
    const { backend, prototype, app, user } = await setup(mode);
    const old = await backend.uploadPhoto(
      visit.id,
      new File(['old'], 'old.webp', { type: 'image/webp' }),
    );
    await backend.saveVisit({ ...visit, photos: [old] });
    app.unmount();
    const GarageApp = await loadGarageTestApp();
    render(<GarageApp />);
    await user.click(
      within(await screen.findByRole('table')).getByRole('button', { name: 'Edit visit' }),
    );
    const element = screen.getByRole('dialog');
    const dialog = within(element);
    await user.click(dialog.getByRole('button', { name: 'Remove old.webp' }));
    fireEvent.change(element.querySelector('input[type="file"]')!, {
      target: { files: [new File(['new'], 'new.webp', { type: 'image/webp' })] },
    });
    await dialog.findByText('new.webp');
    const remove = vi
      .spyOn(prototype, 'removePhoto')
      .mockRejectedValueOnce(new Error('Cleanup failed'));
    await user.click(dialog.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const saved = (await backend.load()).visits[0];
    expect(saved.id).toBe(visit.id);
    expect(saved.photos.map((photo) => photo.name)).toEqual(['new.webp']);
    expect(remove).toHaveBeenCalledExactlyOnceWith(old);
    if (mode === 'local') expect(await get(`photo:${saved.photos[0].path}`)).toBeInstanceOf(Blob);
    else expect(cloud.photos.has(saved.photos[0].path)).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

it('stays on the current page when a new car saves but refresh fails', async () => {
  const { backend, prototype, user } = await setup('local');
  await user.click(
    within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('link', {
      name: 'My cars',
    }),
  );
  testRouter.push.mockClear();
  await user.click(screen.getByRole('button', { name: 'Add a car' }));
  const dialog = within(screen.getByRole('dialog'));
  await user.type(dialog.getByLabelText('Nickname'), 'Saved car');
  await user.type(dialog.getByLabelText('Make'), 'Toyota');
  await user.type(dialog.getByLabelText('Model'), 'RAV4');
  fireEvent.change(dialog.getByLabelText('Current odometer (miles)'), { target: { value: '200' } });
  vi.spyOn(prototype, 'load').mockRejectedValueOnce(new Error('Refresh failed'));
  await user.click(dialog.getByRole('button', { name: 'Add car' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(testRouter.url).toBe(`/cars/${car.id}`);
  expect(testRouter.push).not.toHaveBeenCalled();
  expect((await backend.load()).cars.some((entry) => entry.name === 'Saved car')).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Retry refresh' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});
