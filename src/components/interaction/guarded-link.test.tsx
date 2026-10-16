import { testRouter } from '../../test/garage-router';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, expect, it } from 'vitest';
import { InteractionTestProvider } from '@/test/interaction-wrapper';
import { useFormInteraction } from './use-form-interaction';
import Link, { useGuardedRouter } from './guarded-link';

function Editor() {
  const [value, setValue] = useState('');
  const interaction = useFormInteraction(value);
  const router = useGuardedRouter();
  return (
    <>
      <input aria-label="Draft" value={value} onChange={(event) => setValue(event.target.value)} />
      <Link href="/reports?year=2026">Reports</Link>
      <button onClick={() => router.replace('/history')}>Replace</button>
      <button onClick={() => interaction.accept()}>Save</button>
      <Link href="/cars" onNavigate={(event) => event.preventDefault()}>
        Stay
      </Link>
    </>
  );
}
beforeEach(() => testRouter.reset('/'));

it('guards links and imperative navigation, preserves destinations, and resumes once', async () => {
  const user = userEvent.setup();
  render(
    <InteractionTestProvider>
      <Editor />
    </InteractionTestProvider>,
  );
  await user.type(screen.getByLabelText('Draft'), 'Unsaved');
  await user.click(screen.getByText('Reports'));
  expect(testRouter.url).toBe('/');
  await user.click(screen.getByText('Keep editing'));
  expect(screen.getByLabelText('Draft')).toHaveProperty('value', 'Unsaved');
  await user.click(screen.getByText('Reports'));
  await user.click(screen.getByText('Discard changes'));
  expect(testRouter.url).toBe('/reports?year=2026');
  expect(testRouter.push).toHaveBeenCalledOnce();
  await user.click(screen.getByText('Save'));
  await user.click(screen.getByText('Replace'));
  expect(testRouter.url).toBe('/history');
  expect(testRouter.entries).toEqual(['/', '/history']);
  await user.click(screen.getByText('Stay'));
  expect(testRouter.url).toBe('/history');
});

it('leaves modified clicks to the browser without discarding the current draft', async () => {
  const user = userEvent.setup();
  render(
    <InteractionTestProvider>
      <Editor />
    </InteractionTestProvider>,
  );
  await user.type(screen.getByLabelText('Draft'), 'Unsaved');
  document.addEventListener('click', (event) => event.preventDefault(), { once: true });
  fireEvent.click(screen.getByText('Reports'), { ctrlKey: true });
  expect(testRouter.push).not.toHaveBeenCalled();
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.getByLabelText('Draft')).toHaveProperty('value', 'Unsaved');
});
