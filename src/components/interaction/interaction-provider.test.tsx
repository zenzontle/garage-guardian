import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import en from '../../../messages/en.json';
import es from '../../../messages/es.json';
import { useInteractions } from './interaction-provider';
import { InteractionTestProvider as Wrapper } from '@/test/interaction-wrapper';
import { useFormInteraction } from './use-form-interaction';
import { Modal } from '../ui/modal';

function Form({
  name,
  pending = false,
  action,
  remove,
}: {
  name?: string;
  pending?: boolean;
  action?: () => void;
  remove?: () => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const interaction = useFormInteraction(value, {
    busy: pending,
    enabled: Boolean(name),
    group: 'settings',
    onDiscard: () => setValue(''),
  });
  const interactions = useInteractions()!;
  return (
    <div>
      {name && (
        <>
          <input aria-label={name} value={value} onChange={(e) => setValue(e.target.value)} />
          <button onClick={() => interaction.accept()}>Save {name}</button>
        </>
      )}
      {action && (
        <>
          <button onClick={() => interactions.request(action)}>Leave</button>
          <button onClick={() => interactions.notify('interactions.carSaved')}>Notify</button>
        </>
      )}
      {remove && (
        <button
          onClick={() =>
            interactions.confirmDelete({
              title: 'Delete vehicle?',
              description: en.interactions.deleteCar,
              onDelete: remove,
              success: 'interactions.carDeleted',
            })
          }
        >
          Remove
        </button>
      )}
    </div>
  );
}
afterEach(() => vi.useRealTimers());

it.each(['en', 'es'] as const)(
  'protects independent forms, reverts, and announces confirmations in %s',
  async (locale) => {
    const copy = locale === 'en' ? en : es;
    const action = vi.fn();
    const user = userEvent.setup();
    render(
      <Wrapper locale={locale}>
        <Form name="Email" />
        <Form name="Password" />
        <Form action={action} />
      </Wrapper>,
    );
    await user.type(screen.getByLabelText('Email'), 'draft');
    await user.type(screen.getByLabelText('Password'), 'secret');
    await user.click(screen.getByText('Save Email'));
    await user.click(screen.getByText('Leave'));
    const confirmation = screen.getByRole('alertdialog');
    expect(confirmation.getAttribute('aria-label')).toBe(copy.interactions.unsavedTitle);
    expect(document.activeElement?.textContent).toBe(copy.interactions.keepEditing);
    expect(screen.getByLabelText('Email').closest<HTMLElement>('body > div')?.inert).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByLabelText('Password')).toHaveProperty('value', 'secret');
    await user.clear(screen.getByLabelText('Password'));
    await user.click(screen.getByText('Leave'));
    expect(action).toHaveBeenCalledOnce();
    await user.click(screen.getByText('Notify'));
    expect(screen.getByRole('status').textContent).toBe(copy.interactions.carSaved);
  },
);

it('discards once, resets the draft, and guards unload only while dirty or busy', async () => {
  const action = vi.fn();
  const user = userEvent.setup();
  render(
    <Wrapper>
      <Form name="Draft" />
      <Form action={action} />
    </Wrapper>,
  );
  const unload = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(unload()).toBe(false);
  await user.type(screen.getByLabelText('Draft'), 'work');
  expect(unload()).toBe(true);
  await user.click(screen.getByText('Leave'));
  await user.click(screen.getByText(en.interactions.discard));
  expect(action).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('Draft')).toHaveProperty('value', '');
  expect(unload()).toBe(false);
});

it('blocks every modal dismissal and navigation while a mutation is pending', async () => {
  const close = vi.fn();
  const leave = vi.fn();
  const user = userEvent.setup();
  render(
    <Wrapper>
      <Modal title="Saving" onClose={close} busy>
        <Form name="Busy" pending />
        <div className="modal-footer">
          <Form action={leave} />
        </div>
      </Modal>
    </Wrapper>,
  );
  await user.keyboard('{Escape}');
  fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
  await user.click(screen.getByText('Leave'));
  expect(close).not.toHaveBeenCalled();
  expect(leave).not.toHaveBeenCalled();
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});

it('retains failed deletes for retry and prevents duplicate requests', async () => {
  let fail!: () => void;
  const remove = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          fail = () => reject(new Error('offline'));
        }),
    )
    .mockResolvedValue(undefined);
  const user = userEvent.setup();
  render(
    <Wrapper>
      <Form remove={remove} />
    </Wrapper>,
  );
  await user.click(screen.getByText('Remove'));
  expect(document.activeElement?.textContent).toBe('Cancel');
  const dialog = within(screen.getByRole('alertdialog'));
  await user.click(dialog.getByText('Delete', { exact: true }));
  await user.keyboard('{Escape}');
  fireEvent.mouseDown(screen.getByRole('alertdialog').parentElement!);
  expect(remove).toHaveBeenCalledOnce();
  await act(async () => fail());
  expect(dialog.getByRole('alert').textContent).toBe(en.interactions.deleteFailed);
  await user.click(dialog.getByText('Delete', { exact: true }));
  expect(remove).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.getByRole('status').textContent).toBe(en.interactions.carDeleted);
});

it('pauses the success timeout on hover, focus and a hidden document', () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  render(
    <Wrapper>
      <Form action={() => {}} />
    </Wrapper>,
  );
  fireEvent.click(screen.getByText('Notify'));
  act(() => vi.advanceTimersByTime(2000));
  const toast = screen.getByRole('status').parentElement!;
  fireEvent.mouseEnter(toast);
  act(() => vi.advanceTimersByTime(10000));
  expect(screen.getByRole('status')).toBeDefined();
  fireEvent.mouseLeave(toast);
  fireEvent.focus(within(toast).getByRole('button'));
  act(() => vi.advanceTimersByTime(10000));
  fireEvent.blur(within(toast).getByRole('button'));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  fireEvent(document, new Event('visibilitychange'));
  act(() => vi.advanceTimersByTime(10000));
  expect(screen.getByRole('status')).toBeDefined();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  fireEvent(document, new Event('visibilitychange'));
  act(() => vi.advanceTimersByTime(4001));
  expect(screen.queryByRole('status')).toBeNull();
});
