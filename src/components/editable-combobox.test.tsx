import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EditableCombobox } from './editable-combobox';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../messages/en.json';

const suggestions = ['Honda', 'Toyota', 'Toyland'].map((name) => ({ id: name, lookup_key: name.toLowerCase(), display_name: name }));
function Harness({ failed = false, loading = false, entries = suggestions, retry = vi.fn() }) {
  const [value, setValue] = useState('');
  return <NextIntlClientProvider locale="en" messages={en} timeZone="UTC"><form onSubmit={(event) => event.preventDefault()}><EditableCombobox label="Make" value={value} onChange={setValue} suggestions={entries} failed={failed} loading={loading} onRetry={retry} /><button>Save</button></form></NextIntlClientProvider>;
}
describe('editable combobox', () => {
  it('announces the active option, wraps navigation, selects with Enter without submission, and closes with Escape', async () => {
    const submit = vi.fn(), escape = vi.fn();
    const user = userEvent.setup();
    const view = render(<Harness />);
    view.container.addEventListener('submit', submit);
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') escape(); };
    window.addEventListener('keydown', onEscape);
    const input = screen.getByRole('combobox', { name: 'Make' });
    await user.click(input);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{ArrowUp}');
    expect(document.getElementById(input.getAttribute('aria-activedescendant')!)?.textContent).toBe('Toyota');
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { selected: true }).textContent).toBe('Honda');
    await user.keyboard('{Enter}');
    expect((input as HTMLInputElement).value).toBe('Honda');
    expect(submit).not.toHaveBeenCalled(); expect(document.activeElement).toBe(input);
    await user.click(input); await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull(); expect(escape).not.toHaveBeenCalled();
    await user.keyboard('{Escape}'); expect(escape).toHaveBeenCalledTimes(1);
    window.removeEventListener('keydown', onEscape);
  });
  it('never forces selection on blur, Tab or Enter with no active option and preserves arbitrary text', async () => {
    render(<Harness />);
    const user = userEvent.setup(), input = screen.getByRole('combobox');
    await user.type(input, 'toy'); await user.keyboard('{Enter}');
    expect((input as HTMLInputElement).value).toBe('toy');
    await user.click(input); await user.keyboard('{ArrowDown}{Tab}');
    expect((input as HTMLInputElement).value).toBe('toy'); expect(screen.queryByRole('listbox')).toBeNull();
    await user.clear(input); await user.type(input, 'Unlisted');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect((input as HTMLInputElement).value).toBe('Unlisted');
    expect(input.getAttribute('maxlength')).toBe('50'); expect(input.hasAttribute('required')).toBe(true);
  });
  it('supports pointer and touch selection, loading, failure and retry', async () => {
    const retry = vi.fn(), user = userEvent.setup();
    const view = render(<Harness loading />);
    const input = screen.getByRole('combobox');
    expect(screen.getByRole('status').textContent).toContain('Loading');
    await user.click(input);
    await user.click(screen.getByRole('option', { name: 'Toyota' }));
    expect((input as HTMLInputElement).value).toBe('Toyota'); expect(document.activeElement).toBe(input);
    await user.clear(input);
    const honda = screen.getByRole('option', { name: 'Honda' });
    await user.pointer([{ keys: '[TouchA>]', target: honda }, { keys: '[/TouchA]', target: honda }]);
    expect((input as HTMLInputElement).value).toBe('Honda');
    view.rerender(<Harness failed entries={[]} retry={retry} />);
    expect(screen.getByRole('status').textContent).toContain('unavailable');
    fireEvent.change(input, { target: { value: 'Custom' } });
    await user.click(screen.getByRole('button', { name: 'Retry make suggestions' }));
    expect(retry).toHaveBeenCalledOnce(); expect((input as HTMLInputElement).value).toBe('Custom');
  });
});
