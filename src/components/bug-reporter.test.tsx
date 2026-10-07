import { fireEvent, render as renderUI, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BugReporter } from './bug-reporter';
import { LocaleProvider } from './locale-provider';
import { metadata, oversizedReport } from '@/lib/bug-reports/fixtures.test-helper';
import { recordDiagnostic } from '@/lib/bug-reports/diagnostics';

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/repository', () => ({ supabase: { auth } }));
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  auth.getSession
    .mockReset()
    .mockResolvedValue({ data: { session: { access_token: 'verified-session-token' } } });
  localStorage.clear();
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
  fetchMock = vi.fn().mockImplementation(async () => Response.json({ enabled: true, metadata }));
  vi.stubGlobal('fetch', fetchMock);
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:screenshot'), revokeObjectURL: vi.fn() });
});
function render(ui: ReactNode) {
  return renderUI(ui, { wrapper: LocaleProvider });
}
async function openReport() {
  const user = userEvent.setup();
  render(<BugReporter userId="account" screen="cars" dialog="add-car" />);
  await user.click(await screen.findByRole('button', { name: 'Report a bug' }));
  return user;
}
async function review(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Title'), 'Clipped car dialog');
  await user.type(
    screen.getByLabelText('Description'),
    'Open the car dialog. Expected readable fields; actual fields are clipped.',
  );
  await user.click(screen.getByRole('button', { name: 'Review report' }));
}
function failSessionLookup(failure: 'missing' | 'rejected') {
  if (failure === 'rejected')
    auth.getSession.mockRejectedValueOnce(new Error('private storage failure'));
  else auth.getSession.mockResolvedValueOnce({ data: { session: null } });
}
describe('authenticated public bug reporter', () => {
  it('hides language selection while loading and restores it in recovery without losing the draft', async () => {
    const user = userEvent.setup();
    const rendered = render(<BugReporter userId="account" screen="loading" dialog="none" />);
    await user.click(await screen.findByRole('button', { name: 'Report a bug' }));
    expect(screen.queryByRole('combobox', { name: 'Language' })).toBeNull();
    await user.type(screen.getByLabelText('Title'), 'Slow garage transfer');
    rendered.rerender(<BugReporter userId="account" screen="recovery" dialog="none" />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'es');
    expect(screen.getByDisplayValue('Slow garage transfer')).toBeDefined();
    rendered.rerender(<BugReporter userId="account" screen="loading" dialog="none" />);
    expect(screen.queryByRole('combobox', { name: 'Idioma' })).toBeNull();
    expect(screen.getByDisplayValue('Slow garage transfer')).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('keeps oversized reports reviewable and blocks publication until diagnostics are removed', async () => {
    const user = await openReport(),
      large = oversizedReport();
    large.diagnostics.forEach((entry) => {
      const cause = new Error(entry.message);
      cause.stack = entry.stack;
      recordDiagnostic(cause);
    });
    await user.type(screen.getByLabelText('Title'), large.title);
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: large.description },
    });
    await user.click(screen.getByRole('button', { name: 'Review report' }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Publish report' }));
    expect(screen.getByRole('alert').textContent).toContain('Remove some diagnostics');
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(0);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'es');
    expect(screen.getByRole('alert').textContent).toContain('Elimina algunos diagnósticos');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Idioma' }), 'en');
    await user.click(screen.getByRole('button', { name: 'Remove all diagnostics' }));
    await user.click(screen.getByRole('checkbox'));
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { state: 'succeeded', issueUrl: `https://github.com/${metadata.repository}/issues/9` },
        { status: 201 },
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Publish report' }));
    await screen.findByRole('link', { name: 'View GitHub issue' });
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body.get('report')).diagnostics).toEqual([]);
  });
  it('does not fetch or display for guests and hides disabled deployments', async () => {
    const rendered = render(<BugReporter screen="dashboard" dialog="none" />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Report a bug' })).toBeNull();
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
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { state: 'succeeded', issueUrl: 'https://github.com/ZenZontle/Garage-Guardian/issues/9' },
        { status: 201 },
      ),
    );
    await user.click(button);
    await screen.findByRole('link', { name: 'View GitHub issue' });
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('/api/bug-reports');
    expect(init.headers.Authorization).toBe('Bearer verified-session-token');
    const report = JSON.parse(init.body.get('report'));
    expect(report.diagnostics).toEqual([]);
    expect(report.context.screen).toBe('cars');
    expect(report.metadata.reporterId).toBe(metadata.reporterId);
    expect(JSON.stringify(report)).not.toContain('verified-session-token');
  });
  it('supports screenshot preview/removal and rejects oversized uploads locally', async () => {
    const user = await openReport();
    const input = screen.getByLabelText('Screenshots (optional)');
    fireEvent.change(input, {
      target: { files: [new File(['image'], 'x.png', { type: 'image/png' })] },
    });
    expect(screen.getByRole('img')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Remove screenshot 1' }));
    expect(screen.queryByRole('img')).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:screenshot');
    fireEvent.change(input, {
      target: {
        files: [new File([new Uint8Array(2 * 1024 * 1024)], 'x.png', { type: 'image/png' })],
      },
    });
    expect(screen.getByRole('alert').textContent).toContain('1.5 MiB');
  });
  it('keeps the same draft across transport failures and checks status instead of reposting', async () => {
    const user = await openReport();
    await review(user);
    await user.click(screen.getByRole('checkbox'));
    fetchMock.mockRejectedValueOnce(new Error('network error'));
    await user.click(screen.getByRole('button', { name: 'Publish report' }));
    await screen.findByRole('alert');
    const submission = JSON.parse(fetchMock.mock.calls.at(-1)![1].body.get('report'));
    fetchMock.mockResolvedValueOnce(Response.json({ state: 'unknown' }, { status: 202 }));
    await user.click(screen.getByRole('button', { name: 'Check submission status' }));
    expect(fetchMock.mock.calls.at(-1)![0]).toBe(`/api/bug-reports/${submission.submissionId}`);
    expect(screen.queryByRole('button', { name: 'Edit report' })).toBeNull();
  });
  it.each(['missing', 'rejected'] as const)(
    'unfreezes the reviewed draft when the initial session lookup is %s before fetch',
    async (failure) => {
      const user = await openReport();
      recordDiagnostic('Synthetic error');
      await review(user);
      await user.click(screen.getByRole('checkbox'));
      const preview = screen.getByText(/Release:/).textContent;
      const callsBeforePublish = fetchMock.mock.calls.length;
      failSessionLookup(failure);
      await user.click(screen.getByRole('button', { name: 'Publish report' }));
      await screen.findByRole('alert');
      expect(screen.getByRole('alert').textContent).toContain(
        failure === 'rejected' ? 'Account verification is unavailable' : 'Sign in again',
      );
      expect(screen.getByRole('alert').textContent).not.toContain('private storage failure');
      expect(fetchMock).toHaveBeenCalledTimes(callsBeforePublish);
      expect(screen.queryByRole('button', { name: 'Edit report' })).not.toBeNull();
      expect(
        screen.getByRole('button', { name: 'Remove all diagnostics' }).matches(':disabled'),
      ).toBe(false);
      expect(screen.queryByRole('button', { name: 'Check submission status' })).toBeNull();
      fetchMock.mockResolvedValueOnce(
        Response.json(
          { state: 'succeeded', issueUrl: `https://github.com/${metadata.repository}/issues/9` },
          { status: 201 },
        ),
      );
      await user.click(screen.getByRole('button', { name: 'Publish report' }));
      await screen.findByRole('link', { name: 'View GitHub issue' });
      const [url, init] = fetchMock.mock.calls.at(-1)!;
      expect(url).toBe('/api/bug-reports');
      expect(init.method).toBe('POST');
      const report = JSON.parse(init.body.get('report'));
      expect(preview).toContain(report.submissionId);
      expect(report.diagnostics).toHaveLength(1);
    },
  );
  it.each(['missing', 'rejected'] as const)(
    'keeps uncertain submissions frozen when the status session lookup is %s before fetch',
    async (failure) => {
      const user = await openReport();
      await review(user);
      await user.click(screen.getByRole('checkbox'));
      fetchMock.mockResolvedValueOnce(Response.json({ state: 'unknown' }, { status: 202 }));
      await user.click(screen.getByRole('button', { name: 'Publish report' }));
      const callsBeforeCheck = fetchMock.mock.calls.length;
      failSessionLookup(failure);
      await user.click(screen.getByRole('button', { name: 'Check submission status' }));
      await screen.findByRole('alert');
      expect(screen.getByRole('alert').textContent).toContain(
        failure === 'rejected' ? 'Account verification is unavailable' : 'Sign in again',
      );
      expect(fetchMock).toHaveBeenCalledTimes(callsBeforeCheck);
      expect(screen.queryByRole('button', { name: 'Edit report' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Publish report' })).toBeNull();
      fetchMock.mockResolvedValueOnce(Response.json({ state: 'unknown' }, { status: 202 }));
      await user.click(screen.getByRole('button', { name: 'Check submission status' }));
      expect(fetchMock.mock.calls.at(-1)![1].method).toBeUndefined();
      expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
    },
  );
  it.each([
    'AUTH_UNAVAILABLE',
    'IP_UNAVAILABLE',
    'NOT_CONFIGURED',
    'LIMITER_UNAVAILABLE',
    'SUBMISSION_NOT_STARTED',
  ])('allows the same reviewed draft to retry after a pre-write %s response', async (code) => {
    const user = await openReport();
    recordDiagnostic('Synthetic error');
    await review(user);
    await user.click(screen.getByRole('checkbox'));
    fetchMock.mockResolvedValueOnce(Response.json({ code }, { status: 503 }));
    await user.click(screen.getByRole('button', { name: 'Publish report' }));
    await screen.findByRole('alert');
    const submission = JSON.parse(fetchMock.mock.calls.at(-1)![1].body.get('report'));
    expect(screen.getByRole('button', { name: 'Edit report' })).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'Remove all diagnostics' }).matches(':disabled'),
    ).toBe(false);
    expect(screen.queryByRole('button', { name: 'Check submission status' })).toBeNull();

    fetchMock.mockResolvedValueOnce(
      Response.json(
        { state: 'succeeded', issueUrl: `https://github.com/${metadata.repository}/issues/9` },
        { status: 201 },
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Publish report' }));
    await screen.findByRole('link', { name: 'View GitHub issue' });
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('/api/bug-reports');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body.get('report'))).toEqual(submission);
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(2);
  });
  it.each(['network', 'non-json', 'disabled', 'http-error'] as const)(
    'unfreezes PREVIEW_CHANGED drafts even when metadata refresh fails with %s',
    async (failure) => {
      const user = await openReport();
      recordDiagnostic('Synthetic error');
      await review(user);
      await user.click(screen.getByRole('checkbox'));
      fetchMock.mockResolvedValueOnce(Response.json({ code: 'PREVIEW_CHANGED' }, { status: 409 }));
      if (failure === 'network') fetchMock.mockRejectedValueOnce(new Error('network error'));
      else if (failure === 'non-json') fetchMock.mockResolvedValueOnce(new Response('Not JSON'));
      else if (failure === 'disabled')
        fetchMock.mockResolvedValueOnce(Response.json({ enabled: false }));
      else fetchMock.mockResolvedValueOnce(Response.json({ code: 'UNAVAILABLE' }, { status: 503 }));
      await user.click(screen.getByRole('button', { name: 'Publish report' }));
      await screen.findByRole('alert');
      const submission = JSON.parse(
        fetchMock.mock.calls.find((call) => call[1]?.method === 'POST')![1].body.get('report'),
      );
      expect(screen.queryByRole('button', { name: 'Edit report' })).not.toBeNull();
      expect(
        screen.getByRole('button', { name: 'Remove all diagnostics' }).matches(':disabled'),
      ).toBe(false);
      expect(screen.queryByRole('button', { name: 'Check submission status' })).toBeNull();
      fetchMock.mockResolvedValueOnce(
        Response.json(
          { state: 'succeeded', issueUrl: `https://github.com/${metadata.repository}/issues/9` },
          { status: 201 },
        ),
      );
      await user.click(screen.getByRole('button', { name: 'Publish report' }));
      await screen.findByRole('link', { name: 'View GitHub issue' });
      const [url, init] = fetchMock.mock.calls.at(-1)!;
      expect(url).toBe('/api/bug-reports');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body.get('report'))).toEqual(submission);
    },
  );
  it('never invites a new POST when a previously uncertain receipt disappears', async () => {
    const user = await openReport();
    await review(user);
    await user.click(screen.getByRole('checkbox'));
    fetchMock.mockResolvedValueOnce(Response.json({ state: 'unknown' }, { status: 202 }));
    await user.click(screen.getByRole('button', { name: 'Publish report' }));
    fetchMock.mockResolvedValueOnce(Response.json({ code: 'NOT_FOUND' }, { status: 404 }));
    await user.click(screen.getByRole('button', { name: 'Check submission status' }));
    expect(screen.getByRole('alert').textContent).toContain('Check GitHub');
    expect(screen.queryByRole('button', { name: 'Publish report' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit report' })).toBeNull();
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
  });
  it('keeps an uncertain submission frozen through status errors and unlocks only an explicit failed receipt', async () => {
    const user = await openReport();
    recordDiagnostic('Synthetic error');
    await review(user);
    await user.click(screen.getByRole('checkbox'));
    fetchMock.mockResolvedValueOnce(Response.json({ state: 'unknown' }, { status: 202 }));
    await user.click(screen.getByRole('button', { name: 'Publish report' }));
    const submission = JSON.parse(fetchMock.mock.calls.at(-1)![1].body.get('report'));
    for (const [status, code] of [
      [429, 'RATE_LIMITED'],
      [503, 'LIMITER_UNAVAILABLE'],
      [502, 'GITHUB_FAILED'],
      [401, 'UNAUTHENTICATED'],
      [409, 'PREVIEW_CHANGED'],
      [503, 'AUTH_UNAVAILABLE'],
      [503, 'IP_UNAVAILABLE'],
      [503, 'NOT_CONFIGURED'],
      [503, 'SUBMISSION_NOT_STARTED'],
      [503, 'UNAVAILABLE'],
    ] as const) {
      fetchMock.mockResolvedValueOnce(
        Response.json({ code, error: 'Do not render provider details' }, { status }),
      );
      await user.click(screen.getByRole('button', { name: 'Check submission status' }));
      expect(screen.getByRole('alert').textContent).not.toContain('Do not render provider details');
      expect(screen.queryByRole('button', { name: 'Edit report' })).toBeNull();
      expect(
        screen.getByRole('button', { name: 'Remove all diagnostics' }).matches(':disabled'),
      ).toBe(true);
      expect(fetchMock.mock.calls.at(-1)![0]).toBe(`/api/bug-reports/${submission.submissionId}`);
      expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
    }
    fetchMock.mockResolvedValueOnce(Response.json({ state: 'failed' }, { status: 202 }));
    await user.click(screen.getByRole('button', { name: 'Check submission status' }));
    expect(screen.getByRole('button', { name: 'Edit report' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Publish report' })).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'Remove all diagnostics' }).matches(':disabled'),
    ).toBe(false);
  });
  it('translates open drafts, validation, provider errors and statuses when switching languages', async () => {
    const user = await openReport();
    await user.click(screen.getByRole('button', { name: 'Review report' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'es');
    expect(screen.getByRole('dialog').textContent).toContain('Reportar un error');
    expect(screen.getByRole('alert').textContent).toContain('Escribe un título');
    expect(screen.getByPlaceholderText(/Pasos para reproducir/)).toBeDefined();
    expect(screen.getByRole('dialog').textContent).toContain('serán públicos');
    await user.type(screen.getByLabelText('Título'), 'Mi reporte sin traducir');
    await user.type(
      screen.getByLabelText('Descripción'),
      'Mis pasos originales para reproducir el error.',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Idioma' }), 'en');
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe(
      'Mi reporte sin traducir',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'es');
    await user.click(screen.getByRole('button', { name: 'Revisar reporte' }));
    await user.click(screen.getByRole('checkbox'));
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { code: 'RATE_LIMITED', error: 'English provider text' },
        { status: 429, headers: { 'Retry-After': '60' } },
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Publicar reporte' }));
    expect(screen.getByRole('alert').textContent).toContain('demasiados reportes');
    expect(screen.getByRole('alert').textContent).toContain('60 segundos');
    expect(screen.getByRole('alert').textContent).not.toContain('English provider text');
    const draft = JSON.parse(fetchMock.mock.calls.at(-1)![1].body.get('report'));
    expect(draft.context.locale).toBe('es');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Idioma' }), 'en');
    expect(screen.getByRole('alert').textContent).toContain('Too many reports');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'es');
    fetchMock.mockResolvedValueOnce(Response.json({ state: 'unknown' }, { status: 202 }));
    await user.click(screen.getByRole('button', { name: 'Publicar reporte' }));
    expect(screen.getByRole('status').textContent).toContain('estado es desconocido');
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body.get('report')).submissionId).toBe(
      draft.submissionId,
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Idioma' }), 'en');
    expect(screen.getByRole('status').textContent).toContain('status is unknown');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'es');
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { state: 'succeeded', issueUrl: `https://github.com/${metadata.repository}/issues/9` },
        { status: 201 },
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Consultar estado del envío' }));
    expect(screen.getByRole('status').textContent).toBe('Tu reporte se ha publicado.');
    expect(screen.getByRole('link', { name: 'Ver issue en GitHub' })).toBeDefined();
  });
  it('traps focus, isolates Escape from existing dialogs, and restores focus', async () => {
    const user = await openReport();
    expect(document.activeElement).toBe(screen.getByLabelText('Title'));
    const underlying = vi.fn();
    window.addEventListener('keydown', underlying);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(underlying).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Report a bug' }));
    window.removeEventListener('keydown', underlying);
  });
  it('keeps the launcher in an existing dialog and bridges its keyboard focus trap', async () => {
    const user = userEvent.setup();
    render(
      <>
        <div className="modal" role="dialog" aria-label="Existing dialog">
          <button>Underlying close</button>
          <input aria-label="Underlying field" />
        </div>
        <BugReporter userId="account" screen="cars" dialog="add-car" />
      </>,
    );
    const launcher = await screen.findByRole('button', { name: 'Report a bug' });
    expect(launcher.closest('[role="dialog"]')).toBe(screen.getByRole('dialog'));
    launcher.focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Underlying close' }));
    await user.click(launcher);
    expect(document.activeElement).toBe(screen.getByLabelText('Title'));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Existing dialog');
    expect(document.activeElement).toBe(launcher);
  });
  it('clears the open draft and diagnostics on an account remount/sign-out', async () => {
    const user = userEvent.setup();
    const rendered = render(
      <BugReporter key="first" userId="first" screen="loading" dialog="none" />,
    );
    await user.click(await screen.findByRole('button', { name: 'Report a bug' }));
    await user.type(screen.getByLabelText('Title'), 'Private draft');
    recordDiagnostic('old account error');
    rendered.rerender(<BugReporter key="guest" screen="dashboard" dialog="none" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByDisplayValue('Private draft')).toBeNull();
    rendered.rerender(<BugReporter key="second" userId="second" screen="recovery" dialog="none" />);
    await user.click(await screen.findByRole('button', { name: 'Report a bug' }));
    expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('');
  });
});
