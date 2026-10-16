import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import { car, schedule } from '@/test/fixtures';
import { LocalRepository } from '@/lib/garage/repository';
import { resizePhoto } from '@/lib/utils/resize-photo';
import { InteractionProvider } from './interaction-provider';
import { CarModal } from '../vehicles/car-modal';
import { ScheduleModal } from '../maintenance/schedule-modal';
import { VisitModal } from '../visits/visit-modal';

vi.mock('@/lib/utils/resize-photo', () => ({ resizePhoto: vi.fn(async (file: File) => file) }));

it.each(['car', 'schedule', 'visit'] as const)(
  'guards all dismissal paths for a changed %s and allows reverting',
  async (kind) => {
    const close = vi.fn();
    const save = vi.fn();
    const form =
      kind === 'car' ? (
        <CarModal item={car} onClose={close} onSave={save} />
      ) : kind === 'schedule' ? (
        <ScheduleModal
          item={schedule}
          carId={car.id}
          distanceUnit="miles"
          onClose={close}
          onSave={save}
        />
      ) : (
        <VisitModal
          cars={[car]}
          visits={[]}
          schedules={[]}
          repository={new LocalRepository()}
          onClose={close}
          onSave={save}
        />
      );
    const user = userEvent.setup();
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <InteractionProvider>{form}</InteractionProvider>
      </NextIntlClientProvider>,
    );
    const dialog = within(screen.getByRole('dialog'));
    const input = dialog.getByRole('textbox', {
      name: kind === 'car' ? 'Nickname' : kind === 'schedule' ? 'Task name' : 'Service item name',
    });
    const initial = (input as HTMLInputElement).value;
    fireEvent.change(input, { target: { value: 'Changed draft' } });
    for (const dismiss of [
      () => user.keyboard('{Escape}'),
      async () => {
        fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
      },
      () => user.click(dialog.getByRole('button', { name: 'Close' })),
      () => user.click(dialog.getByRole('button', { name: 'Cancel' })),
    ]) {
      await dismiss();
      expect(screen.getByRole('alertdialog')).toBeDefined();
      expect(close).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: 'Keep editing' }));
      expect(input).toHaveProperty('value', 'Changed draft');
    }
    fireEvent.change(input, { target: { value: initial } });
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(close).toHaveBeenCalledOnce();
  },
);

it('blocks saving and overlapping file preparation batches, retains the draft after preparation failure', async () => {
  let reject!: (cause: Error) => void;
  vi.mocked(resizePhoto).mockReturnValueOnce(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  const repository = new LocalRepository();
  const upload = vi.spyOn(repository, 'uploadPhoto');
  const save = vi.fn();
  const close = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <InteractionProvider>
        <VisitModal
          cars={[car]}
          visits={[]}
          schedules={[]}
          repository={repository}
          onClose={close}
          onSave={save}
        />
      </InteractionProvider>
    </NextIntlClientProvider>,
  );
  fireEvent.change(screen.getByLabelText('Service item name'), { target: { value: 'Inspection' } });
  const input = document.querySelector('input[type="file"]')!;
  const file = new File(['image'], 'receipt.webp', { type: 'image/webp' });
  fireEvent.change(input, { target: { files: [file] } });
  fireEvent.change(input, { target: { files: [file, file] } });
  fireEvent.submit(document.querySelector('form')!);
  expect(screen.getByRole('status').textContent).toBe(en.interactions.preparingPhotos);
  expect(resizePhoto).toHaveBeenCalledOnce();
  expect(upload).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
  await act(async () => reject(new Error('prepare failed')));
  expect(screen.getByRole('alert')).toBeDefined();
  expect(screen.getByLabelText('Service item name')).toHaveProperty('value', 'Inspection');
  expect(screen.getByRole('button', { name: 'Choose photos' }).matches(':disabled')).toBe(false);
});
