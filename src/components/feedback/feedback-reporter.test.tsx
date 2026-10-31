import { fireEvent, render as renderUI, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FeedbackReporter } from './feedback-reporter';
import { LocaleProvider } from '../i18n/locale-provider';
import { LocaleSelector } from '../i18n/locale-selector';
import { InteractionProvider } from '../interaction/interaction-provider';
import { metadata, oversizedReport } from '@/lib/feedback/fixtures.test-helper';
import { recordDiagnostic } from '@/lib/feedback/diagnostics';
import { workspaceScreen } from '@/lib/navigation/garage-routes';

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/garage/repository', () => ({ supabase: { auth } }));
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
  return renderUI(ui, {
    wrapper: ({ children }) => (
      <LocaleProvider>
        <LocaleSelector />
        <InteractionProvider>{children}</InteractionProvider>
      </LocaleProvider>
    ),
  });
}
// The garage keeps its own language selector outside the inert report dialog.
function switchLocale(locale: 'en' | 'es') {
  fireEvent.change(screen.getByRole('combobox', { hidden: true }), {
    target: { value: locale },
  });
}
async function openReport() {
  const user = userEvent.setup();
  render(<FeedbackReporter userId="account" screen="cars" dialog="add-car" />);
  await user.click(await screen.findByRole('button', { name: 'Send feedback' }));
  return user;
}
async function review(user: ReturnType<typeof userEvent.setup>) {
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
describe('authenticated private feedback reporter', () => {
  it('protects report drafts on Escape and clears them only after explicit discard', async () => {
    const user = await openReport();
    await user.type(screen.getByLabelText('Description'), 'Unsaved report');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Description')).toHaveProperty('value', 'Unsaved report');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Send feedback' }));
    expect(screen.getByLabelText('Description')).toHaveProperty('value', '');
  });
  it('previews notification settings with its own route and screen', async () => {
    window.history.replaceState(null, '', '/settings/notifications');
    try {
      const user = userEvent.setup();
      render(
        <FeedbackReporter
          userId="account"
          screen={workspaceScreen('/settings/notifications')}
          dialog="none"
        />,
      );
      await user.click(await screen.findByRole('button', { name: 'Send feedback' }));
      await review(user);
      const preview = screen.getByText(/Route: \/settings\/notifications/).textContent;
      expect(preview).toContain('Screen: notifications');
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });
  it('previews a vehicle route template without exposing the ID or URL parameters', async () => {
    window.history.replaceState(null, '', '/cars/private-vehicle?secret=value#fragment');
    try {
      const user = await openReport();
      await review(user);
      expect(screen.getByText(/Route: \/cars\/\[carId\]/)).toBeDefined();
      const preview = screen.getByText(/Route: \/cars\/\[carId\]/).textContent;
      expect(preview).not.toContain('private-vehicle');
      expect(preview).not.toContain('secret=value');
      expect(preview).not.toContain('fragment');
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });
  it('asks only for a description and derives the issue title from it', async () => {
    const user = await openReport();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    expect(within(dialog).queryByLabelText('Title')).toBeNull();
    expect(screen.getByLabelText('Description').getAttribute('placeholder')).toBeNull();
    expect(screen.getByText(/^Example:/)).toBeDefined();
    await review(user);
    expect(
      screen.getByRole('heading', {
        name: '[Feedback] Open the car dialog. Expected readable fields; actual fields are clipped.',
      }),
    ).toBeDefined();
  });
  it('keeps the draft and configuration when the screen changes', async () => {
    const user = userEvent.setup();
    const rendered = render(<FeedbackReporter userId="account" screen="loading" dialog="none" />);
    await user.click(await screen.findByRole('button', { name: 'Send feedback' }));
    await user.type(screen.getByLabelText('Description'), 'Slow garage transfer');
    rendered.rerender(<FeedbackReporter userId="account" screen="recovery" dialog="none" />);
    expect(screen.getByDisplayValue('Slow garage transfer')).toBeDefined();
    rendered.rerender(<FeedbackReporter userId="account" screen="dashboard" dialog="none" />);
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
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: large.description },
    });
    await user.click(screen.getByRole('button', { name: 'Review report' }));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    expect(screen.getByRole('alert').textContent).toContain('Remove some diagnostics');
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(0);
    switchLocale('es');
    expect(screen.getByRole('alert').textContent).toContain('Elimina algunos diagnósticos');
    switchLocale('en');
    await user.click(screen.getByRole('button', { name: 'Remove all diagnostics' }));
    await user.click(screen.getByRole('checkbox'));
    fetchMock.mockResolvedValueOnce(
      Response.json({ state: 'succeeded', issueReference: 'FB-9' }, { status: 201 }),
    );
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    await screen.findByText('Report FB-9 received');
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body.get('report')).diagnostics).toEqual([]);
  });
  it('does not fetch or display for guests and hides disabled deployments', async () => {
    const rendered = render(<FeedbackReporter screen="dashboard" dialog="none" />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Send feedback' })).toBeNull();
    fetchMock.mockResolvedValue(Response.json({ enabled: false }));
    rendered.rerender(<FeedbackReporter userId="account" screen="dashboard" dialog="none" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'Send feedback' })).toBeNull();
  });
  it('previews diagnostics and screen state, requires acknowledgment, and uses a bearer session', async () => {
    const user = await openReport();
    recordDiagnostic('token=secret broken layout');
    await review(user);
    expect(screen.getByText(/Complete report text/)).toBeDefined();
    expect(screen.getByText(/Screen: cars/)).toBeDefined();
    expect(screen.getByText(/Dialog: add-car/)).toBeDefined();
    const button = screen.getByRole('button', { name: 'Send report' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.queryByText('token=secret broken layout')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Remove all diagnostics' }));
    await user.click(screen.getByRole('checkbox'));
    fetchMock.mockResolvedValueOnce(
      Response.json({ state: 'succeeded', issueReference: 'FB-9' }, { status: 201 }),
    );
    await user.click(button);
    await screen.findByText('Report FB-9 received');
    expect(screen.getByRole('status').textContent).toBe(
      'Your report was sent privately to the developer.',
    );
    expect(screen.queryByRole('link')).toBeNull();
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('/api/feedback');
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
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    await screen.findByRole('alert');
    const submission = JSON.parse(fetchMock.mock.calls.at(-1)![1].body.get('report'));
    fetchMock.mockResolvedValueOnce(Response.json({ state: 'unknown' }, { status: 202 }));
    await user.click(screen.getByRole('button', { name: 'Check submission status' }));
    expect(fetchMock.mock.calls.at(-1)![0]).toBe(`/api/feedback/${submission.submissionId}`);
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
      await user.click(screen.getByRole('button', { name: 'Send report' }));
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
        Response.json({ state: 'succeeded', issueReference: 'FB-9' }, { status: 201 }),
      );
      await user.click(screen.getByRole('button', { name: 'Send report' }));
      await screen.findByText('Report FB-9 received');
      const [url, init] = fetchMock.mock.calls.at(-1)!;
      expect(url).toBe('/api/feedback');
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
      await user.click(screen.getByRole('button', { name: 'Send report' }));
      const callsBeforeCheck = fetchMock.mock.calls.length;
      failSessionLookup(failure);
      await user.click(screen.getByRole('button', { name: 'Check submission status' }));
      await screen.findByRole('alert');
      expect(screen.getByRole('alert').textContent).toContain(
        failure === 'rejected' ? 'Account verification is unavailable' : 'Sign in again',
      );
      expect(fetchMock).toHaveBeenCalledTimes(callsBeforeCheck);
      expect(screen.queryByRole('button', { name: 'Edit report' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Send report' })).toBeNull();
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
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    await screen.findByRole('alert');
    const submission = JSON.parse(fetchMock.mock.calls.at(-1)![1].body.get('report'));
    expect(screen.getByRole('button', { name: 'Edit report' })).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'Remove all diagnostics' }).matches(':disabled'),
    ).toBe(false);
    expect(screen.queryByRole('button', { name: 'Check submission status' })).toBeNull();

    fetchMock.mockResolvedValueOnce(
      Response.json({ state: 'succeeded', issueReference: 'FB-9' }, { status: 201 }),
    );
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    await screen.findByText('Report FB-9 received');
    const [url, init] = fetchMock.mock.calls.at(-1)!;
    expect(url).toBe('/api/feedback');
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
      await user.click(screen.getByRole('button', { name: 'Send report' }));
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
        Response.json({ state: 'succeeded', issueReference: 'FB-9' }, { status: 201 }),
      );
      await user.click(screen.getByRole('button', { name: 'Send report' }));
      await screen.findByText('Report FB-9 received');
      const [url, init] = fetchMock.mock.calls.at(-1)!;
      expect(url).toBe('/api/feedback');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body.get('report'))).toEqual(submission);
    },
  );
  it('never invites a new POST when a previously uncertain receipt disappears', async () => {
    const user = await openReport();
    await review(user);
    await user.click(screen.getByRole('checkbox'));
    fetchMock.mockResolvedValueOnce(Response.json({ state: 'unknown' }, { status: 202 }));
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    fetchMock.mockResolvedValueOnce(Response.json({ code: 'NOT_FOUND' }, { status: 404 }));
    await user.click(screen.getByRole('button', { name: 'Check submission status' }));
    expect(screen.getByRole('alert').textContent).toContain('delivery cannot be confirmed');
    expect(screen.queryByRole('button', { name: 'Send report' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit report' })).toBeNull();
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
  });
  it('keeps an uncertain submission frozen through status errors and unlocks only an explicit failed receipt', async () => {
    const user = await openReport();
    recordDiagnostic('Synthetic error');
    await review(user);
    await user.click(screen.getByRole('checkbox'));
    fetchMock.mockResolvedValueOnce(Response.json({ state: 'unknown' }, { status: 202 }));
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    const submission = JSON.parse(fetchMock.mock.calls.at(-1)![1].body.get('report'));
    for (const [status, code] of [
      [429, 'RATE_LIMITED'],
      [503, 'LIMITER_UNAVAILABLE'],
      [502, 'DELIVERY_FAILED'],
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
      expect(fetchMock.mock.calls.at(-1)![0]).toBe(`/api/feedback/${submission.submissionId}`);
      expect(fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1);
    }
    fetchMock.mockResolvedValueOnce(Response.json({ state: 'failed' }, { status: 202 }));
    await user.click(screen.getByRole('button', { name: 'Check submission status' }));
    expect(screen.getByRole('button', { name: 'Edit report' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Send report' })).toBeDefined();
    expect(
      screen.getByRole('button', { name: 'Remove all diagnostics' }).matches(':disabled'),
    ).toBe(false);
  });
  it('translates open drafts, validation, provider errors and statuses when switching languages', async () => {
    const user = await openReport();
    await user.click(screen.getByRole('button', { name: 'Review report' }));
    switchLocale('es');
    expect(screen.getByRole('dialog').textContent).toContain('Enviar comentarios');
    expect(screen.getByRole('alert').textContent).toContain('Escribe una descripción');
    expect(screen.getByText(/^Ejemplo:/)).toBeDefined();
    expect(screen.getByRole('dialog').textContent).toContain('serán públicos');
    await user.type(
      screen.getByLabelText('Descripción'),
      'Mis pasos originales para reproducir el error.',
    );
    switchLocale('en');
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe(
      'Mis pasos originales para reproducir el error.',
    );
    switchLocale('es');
    await user.click(screen.getByRole('button', { name: 'Revisar reporte' }));
    await user.click(screen.getByRole('checkbox'));
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { code: 'RATE_LIMITED', error: 'English provider text' },
        { status: 429, headers: { 'Retry-After': '60' } },
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Enviar reporte' }));
    expect(screen.getByRole('alert').textContent).toContain('demasiados reportes');
    expect(screen.getByRole('alert').textContent).toContain('60 segundos');
    expect(screen.getByRole('alert').textContent).not.toContain('English provider text');
    const draft = JSON.parse(fetchMock.mock.calls.at(-1)![1].body.get('report'));
    expect(draft.context.locale).toBe('es');
    switchLocale('en');
    expect(screen.getByRole('alert').textContent).toContain('Too many reports');
    switchLocale('es');
    fetchMock.mockResolvedValueOnce(Response.json({ state: 'unknown' }, { status: 202 }));
    await user.click(screen.getByRole('button', { name: 'Enviar reporte' }));
    expect(screen.getByRole('status').textContent).toContain('estado es desconocido');
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body.get('report')).submissionId).toBe(
      draft.submissionId,
    );
    switchLocale('en');
    expect(screen.getByRole('status').textContent).toContain('status is unknown');
    switchLocale('es');
    fetchMock.mockResolvedValueOnce(
      Response.json({ state: 'succeeded', issueReference: 'FB-9' }, { status: 201 }),
    );
    await user.click(screen.getByRole('button', { name: 'Consultar estado del envío' }));
    expect(screen.getByRole('status').textContent).toBe(
      'Tu reporte se envió de forma privada al desarrollador.',
    );
    expect(screen.getByText('Reporte FB-9 recibido')).toBeDefined();
  });
  it('traps focus, isolates Escape from existing dialogs, and restores focus', async () => {
    const user = await openReport();
    expect(document.activeElement).toBe(screen.getByLabelText('Description'));
    const underlying = vi.fn();
    window.addEventListener('keydown', underlying);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(underlying).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Send feedback' }));
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
        <FeedbackReporter userId="account" screen="cars" dialog="add-car" />
      </>,
    );
    const launcher = await screen.findByRole('button', { name: 'Send feedback' });
    expect(launcher.closest('[role="dialog"]')).toBe(screen.getByRole('dialog'));
    launcher.focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Underlying close' }));
    await user.click(launcher);
    expect(document.activeElement).toBe(screen.getByLabelText('Description'));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toBe('Existing dialog');
    expect(document.activeElement).toBe(launcher);
  });
  it('returns focus to the replacement launcher when an underlying form closes', async () => {
    const user = userEvent.setup();
    const app = render(
      <>
        <div className="modal" role="dialog" aria-label="Existing dialog">
          <button>Underlying close</button>
        </div>
        <FeedbackReporter userId="account" screen="cars" dialog="add-car" />
      </>,
    );
    await user.click(await screen.findByRole('button', { name: 'Send feedback' }));
    app.rerender(
      <>
        <div />
        <FeedbackReporter userId="account" screen="cars" dialog="none" />
      </>,
    );
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Send feedback' }));
  });
  it('clears the open draft and diagnostics on an account remount/sign-out', async () => {
    const user = userEvent.setup();
    const rendered = render(
      <FeedbackReporter key="first" userId="first" screen="loading" dialog="none" />,
    );
    await user.click(await screen.findByRole('button', { name: 'Send feedback' }));
    await user.type(screen.getByLabelText('Description'), 'Private draft');
    recordDiagnostic('old account error');
    rendered.rerender(<FeedbackReporter key="guest" screen="dashboard" dialog="none" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByDisplayValue('Private draft')).toBeNull();
    rendered.rerender(
      <FeedbackReporter key="second" userId="second" screen="recovery" dialog="none" />,
    );
    await user.click(await screen.findByRole('button', { name: 'Send feedback' }));
    expect((screen.getByLabelText('Description') as HTMLTextAreaElement).value).toBe('');
  });
});
