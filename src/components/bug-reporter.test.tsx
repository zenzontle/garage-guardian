import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BugReporter } from './bug-reporter';
import { metadata } from '@/lib/bug-reports/fixtures.test-helper';
import { recordDiagnostic } from '@/lib/bug-reports/diagnostics';

vi.mock('@/lib/repository', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'verified-session-token' } } }) } } }));
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn().mockImplementation(async () => Response.json({ enabled: true, metadata }));
  vi.stubGlobal('fetch', fetchMock);
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:screenshot'), revokeObjectURL: vi.fn() });
});
async function openReport() {
  const user = userEvent.setup();
  render(<BugReporter userId="account" screen="cars" dialog="add-car" />);
  await user.click(await screen.findByRole('button', { name: 'Report a bug' }));
  return user;
}
async function review(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Title'), 'Clipped car dialog');
  await user.type(screen.getByLabelText('Description'), 'Open the car dialog. Expected readable fields; actual fields are clipped.');
  await user.click(screen.getByRole('button', { name: 'Review report' }));
}
describe('authenticated public bug reporter', () => {
  it('does not fetch or display for guests and hides disabled deployments', async () => {
    const rendered = render(<BugReporter screen="dashboard" dialog="none" />);
    expect(fetchMock).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Report a bug' })).toBeNull();
    fetchMock.mockResolvedValue(Response.json({ enabled: false }));
    rendered.rerender(<BugReporter userId="account" screen="dashboard" dialog="none" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Report a bug' })).toBeNull();
  });
  it('previews diagnostics and screen state, requires acknowledgment, and uses a bearer session', async () => {
    const user = await openReport();
    recordDiagnostic('token=secret broken layout');
    await review(user);
    expect(screen.getByText(/Complete public issue text/)).toBeDefined();
    expect(screen.getByText(/Screen: cars/)).toBeDefined();
    expect(screen.getByText(/Dialog: add-car/)).toBeDefined();
    const button = screen.getByRole('button', { name: 'Publish report' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.queryByText('token=secret broken layout')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Remove all diagnostics' }));
    await user.click(screen.getByRole('checkbox'));
    fetchMock.mockResolvedValueOnce(Response.json({ state: 'succeeded', issueUrl: `https://github.com/${metadata.repository}/issues/9` }, { status: 201 }));
    await user.click(button);
    await screen.findByRole('link', { name: 'View GitHub issue' });
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('/api/bug-reports'); expect(init.headers.Authorization).toBe('Bearer verified-session-token');
    const report = JSON.parse(init.body.get('report'));
    expect(report.diagnostics).toEqual([]); expect(report.context.screen).toBe('cars'); expect(report.metadata.reporterId).toBe(metadata.reporterId);
    expect(JSON.stringify(report)).not.toContain('verified-session-token');
  });
  it('supports screenshot preview/removal and rejects oversized uploads locally', async () => {
    const user = await openReport();
    const input = screen.getByLabelText('Screenshots (optional)');
    fireEvent.change(input, { target: { files: [new File(['image'], 'x.png', { type: 'image/png' })] } });
    expect(screen.getByRole('img')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Remove screenshot 1' }));
    expect(screen.queryByRole('img')).toBeNull(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:screenshot');
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(2 * 1024 * 1024)], 'x.png', { type: 'image/png' })] } });
    expect(screen.getByRole('alert').textContent).toContain('1.5 MiB');
  });
  it('keeps the same draft across transport failures and checks status instead of reposting', async () => {
    const user = await openReport(); await review(user); await user.click(screen.getByRole('checkbox'));
    fetchMock.mockRejectedValueOnce(new Error('network error'));
    await user.click(screen.getByRole('button', { name: 'Publish report' }));
    await screen.findByRole('alert');
    const submission = JSON.parse(fetchMock.mock.calls.at(-1)![1].body.get('report'));
    fetchMock.mockResolvedValueOnce(Response.json({ state: 'unknown' }, { status: 202 }));
    await user.click(screen.getByRole('button', { name: 'Check submission status' }));
    expect(fetchMock.mock.calls.at(-1)![0]).toBe(`/api/bug-reports/${submission.submissionId}`);
    expect(screen.queryByRole('button', { name: 'Edit report' })).toBeNull();
  });
  it('never invites a new POST when a previously uncertain receipt disappears', async () => {
    const user = await openReport(); await review(user); await user.click(screen.getByRole('checkbox'));
    fetchMock.mockResolvedValueOnce(Response.json({ state: 'unknown' }, { status: 202 }));
    await user.click(screen.getByRole('button', { name: 'Publish report' }));
    fetchMock.mockResolvedValueOnce(Response.json({ code: 'NOT_FOUND' }, { status: 404 }));
    await user.click(screen.getByRole('button', { name: 'Check submission status' }));
    expect(screen.getByRole('alert').textContent).toContain('Check GitHub');
    expect(screen.queryByRole('button', { name: 'Publish report' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit report' })).toBeNull();
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
  });
  it('traps focus, isolates Escape from existing dialogs, and restores focus', async () => {
    const user = await openReport();
    expect(document.activeElement).toBe(screen.getByLabelText('Title'));
    const underlying = vi.fn(); window.addEventListener('keydown', underlying);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull(); expect(underlying).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Report a bug' }));
    window.removeEventListener('keydown', underlying);
  });
  it('keeps the launcher in an existing dialog and bridges its keyboard focus trap', async () => {
    const user = userEvent.setup();
    render(<><div className="modal" role="dialog" aria-label="Existing dialog"><button>Underlying close</button><input aria-label="Underlying field" /></div><BugReporter userId="account" screen="cars" dialog="add-car" /></>);
    const launcher = await screen.findByRole('button', { name: 'Report a bug' });
    expect(launcher.closest('[role="dialog"]')).toBe(screen.getByRole('dialog'));
    launcher.focus(); await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Underlying close' }));
    await user.click(launcher);
    expect(document.activeElement).toBe(screen.getByLabelText('Title'));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Existing dialog');
    expect(document.activeElement).toBe(launcher);
  });
  it('clears the open draft and diagnostics on an account remount/sign-out', async () => {
    const user = userEvent.setup();
    const rendered = render(<BugReporter key="first" userId="first" screen="loading" dialog="none" />);
    await user.click(await screen.findByRole('button', { name: 'Report a bug' }));
    await user.type(screen.getByLabelText('Title'), 'Private draft'); recordDiagnostic('old account error');
    rendered.rerender(<BugReporter key="guest" screen="dashboard" dialog="none" />);
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByDisplayValue('Private draft')).toBeNull();
    rendered.rerender(<BugReporter key="second" userId="second" screen="recovery" dialog="none" />);
    await user.click(await screen.findByRole('button', { name: 'Report a bug' }));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('');
  });
});
