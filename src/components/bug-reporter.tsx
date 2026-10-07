'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Bug, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import en from '../../messages/en.json';
import { LocaleSelector } from './locale-selector';
import { BugReportFields } from './bug-report-fields';
import { BugReportPreview } from './bug-report-preview';
import { BugReportScreenshots, type Screenshot } from './bug-report-screenshots';
import { supabase } from '@/lib/repository';
import {
  clearDiagnostics,
  recentDiagnostics,
  startDiagnostics,
} from '@/lib/bug-reports/diagnostics';
import {
  IMAGE_TYPES,
  REPORT_LIMITS,
  fitsIssueBody,
  isRepositoryIssueUrl,
  publicMetadataSchema,
  reportSchema,
  type BugReport,
  type PublicMetadata,
  type ReportContext,
} from '@/lib/bug-reports/shared';

type ReporterErrorCode = keyof typeof en.bugReports.errors;
type ReporterProblem = { code: ReporterErrorCode; retryAfter?: number };
class ReporterFailure extends Error {
  constructor(
    public code: ReporterErrorCode,
    public retryAfter?: number,
  ) {
    super(code);
  }
}
function isReporterErrorCode(value: unknown): value is ReporterErrorCode {
  return typeof value === 'string' && Object.hasOwn(en.bugReports.errors, value);
}

async function authenticatedFetch(url: string, init: RequestInit = {}) {
  const { data } = await supabase!.auth.getSession().catch(() => {
    throw new ReporterFailure('AUTH_UNAVAILABLE');
  });
  if (!data.session) throw new ReporterFailure('UNAUTHENTICATED');
  return fetch(url, {
    ...init,
    cache: 'no-store',
    headers: { ...init.headers, Authorization: `Bearer ${data.session.access_token}` },
  });
}
function trapFocus(event: KeyboardEvent, root: Element | null) {
  if (event.key !== 'Tab') return;
  const controls = root?.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]',
  );
  if (!controls?.length) return;
  const first = controls[0],
    last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
export function BugReporter({
  userId,
  screen,
  dialog: appDialog,
}: {
  userId?: string;
  screen: ReportContext['screen'];
  dialog: ReportContext['dialog'];
}) {
  const t = useTranslations('bugReports');
  const locale = useLocale();
  const [metadata, setMetadata] = useState<PublicMetadata | null>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const filesRef = useRef<Screenshot[]>([]);
  const [draft, setDraft] = useState<BugReport | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<keyof typeof en.bugReports.statuses | null>(null);
  const [error, setError] = useState<ReporterProblem | null>(null);
  const [issueUrl, setIssueUrl] = useState('');
  const [launcherTarget, setLauncherTarget] = useState<Element | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userId || !supabase) return;
    let active = true;
    void authenticatedFetch('/api/bug-reports/config')
      .then(async (response) => {
        if (!response.ok) return;
        const result = await response.json();
        const parsed = publicMetadataSchema.safeParse(result.metadata);
        if (active && result.enabled === true && parsed.success) setMetadata(parsed.data);
      })
      .catch(() => {
        /* Reporting never interrupts the garage. */
      });
    return () => {
      active = false;
      clearDiagnostics();
    };
  }, [userId]);
  useEffect(() => {
    if (metadata && userId) return startDiagnostics();
  }, [metadata, userId]);
  useEffect(() => {
    setLauncherTarget(
      appDialog === 'none' ? null : document.querySelector('.modal:not(.bug-report-modal)'),
    );
  }, [appDialog, metadata]);
  useEffect(() => {
    filesRef.current = screenshots;
  }, [screenshots]);
  useEffect(
    () => () => {
      filesRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    },
    [],
  );
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const siblings = [...document.body.children].filter(
      (element) => element !== portalRef.current,
    ) as HTMLElement[];
    const inert = siblings.map((element) => element.inert);
    siblings.forEach((element) => {
      element.inert = true;
    });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (
      dialogRef.current?.querySelector<HTMLElement>('input:not(:disabled)') ?? dialogRef.current
    )?.focus();
    return () => {
      siblings.forEach((element, index) => {
        element.inert = inert[index];
      });
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
      else document.querySelector<HTMLElement>('.bug-report-launcher')?.focus();
    };
  }, [open]);

  if (!metadata || !userId) return null;
  const close = () => {
    if (!busy) setOpen(false);
  };
  function reset() {
    screenshots.forEach((item) => URL.revokeObjectURL(item.url));
    setScreenshots([]);
    setTitle('');
    setDescription('');
    setDraft(null);
    setAcknowledged(false);
    setSent(false);
    setIssueUrl('');
    setStatus(null);
    setError(null);
  }
  function keyboard(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    trapFocus(event, dialogRef.current);
  }
  function chooseFiles(files: FileList | null) {
    if (!files) return;
    const selected = Array.from(files);
    if (
      screenshots.length + selected.length > 2 ||
      selected.some(
        (file) =>
          !IMAGE_TYPES.includes(file.type as (typeof IMAGE_TYPES)[number]) ||
          file.size > REPORT_LIMITS.file ||
          !file.size,
      )
    ) {
      setError({ code: 'INVALID_FILES' });
      return;
    }
    setError(null);
    setScreenshots((current) => [
      ...current,
      ...selected.map((file) => ({ file, url: URL.createObjectURL(file) })),
    ]);
  }
  function review() {
    const candidate = reportSchema.safeParse({
      submissionId: crypto.randomUUID(),
      title,
      description,
      acknowledged: true,
      metadata,
      context: {
        pathname: window.location.pathname,
        screen,
        dialog: appDialog,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          pixelRatio: window.devicePixelRatio || 1,
        },
        locale,
        online: navigator.onLine,
      },
      diagnostics: recentDiagnostics(),
    });
    if (!candidate.success) {
      setError({ code: 'INVALID_TEXT' });
      return;
    }
    setDraft(candidate.data);
    setAcknowledged(false);
    setSent(false);
    setError(null);
    setStatus(null);
    setIssueUrl('');
  }
  async function deliver(check = false) {
    if (!draft || !acknowledged || busy) return;
    if (!check && !sent && !fitsIssueBody(draft)) {
      setError({ code: 'ISSUE_TOO_LARGE' });
      return;
    }
    setBusy(true);
    setError(null);
    const checking = check || sent;
    try {
      const data = new FormData();
      data.append('report', JSON.stringify(draft));
      screenshots.forEach((item) => data.append('screenshots', item.file));
      // Once a transport failure is possible, check the receipt before reposting.
      setSent(true);
      const response = await authenticatedFetch(
        checking ? `/api/bug-reports/${draft.submissionId}` : '/api/bug-reports',
        checking ? {} : { method: 'POST', body: data },
      );
      const result = await response.json();
      if (!response.ok) {
        if (checking && response.status === 404) {
          throw new ReporterFailure('MISSING_RECEIPT');
        }
        // A status failure says nothing about whether the original write succeeded.
        if (
          !checking &&
          ([401, 404, 413, 415, 422, 429].includes(response.status) ||
            [
              'GITHUB_FAILED',
              'LIMITER_UNAVAILABLE',
              'AUTH_UNAVAILABLE',
              'IP_UNAVAILABLE',
              'NOT_CONFIGURED',
              'SUBMISSION_NOT_STARTED',
            ].includes(result.code))
        )
          setSent(false);
        if (!checking && result.code === 'PREVIEW_CHANGED') {
          setSent(false);
          const fresh = await authenticatedFetch('/api/bug-reports/config');
          const configuration = await fresh.json();
          const parsed = publicMetadataSchema.safeParse(configuration.metadata);
          if (fresh.ok && configuration.enabled === true && parsed.success) {
            setMetadata(parsed.data);
            setDraft(null);
            setAcknowledged(false);
            setSent(false);
          }
        }
        const wait = Number(response.headers.get('retry-after'));
        throw new ReporterFailure(
          isReporterErrorCode(result.code) ? result.code : 'SUBMIT_FAILED',
          Number.isInteger(wait) && wait > 0 && wait <= 86400 ? wait : undefined,
        );
      }
      if (
        result.state === 'succeeded' &&
        typeof result.issueUrl === 'string' &&
        isRepositoryIssueUrl(result.issueUrl, metadata!.repository)
      ) {
        setIssueUrl(result.issueUrl);
        setStatus('published');
      } else if (result.state === 'failed') {
        setSent(false);
        setStatus('failed');
      } else setStatus('unknown');
    } catch (cause) {
      // Authentication rejection cannot create an issue on the initial attempt.
      if (
        !checking &&
        cause instanceof ReporterFailure &&
        ['UNAUTHENTICATED', 'AUTH_UNAVAILABLE'].includes(cause.code)
      )
        setSent(false);
      setError(
        cause instanceof ReporterFailure
          ? { code: cause.code, retryAfter: cause.retryAfter }
          : { code: 'SUBMIT_FAILED' },
      );
    } finally {
      setBusy(false);
    }
  }

  // Portal events follow React ownership, so bridge the underlying modal's Tab trap.
  const launcher = (
    <button
      className="button secondary bug-report-launcher"
      onKeyDown={(event) => trapFocus(event, launcherTarget)}
      onClick={() => {
        if (issueUrl) reset();
        setOpen(true);
      }}
    >
      <Bug size={16} />
      {t('launch')}
    </button>
  );
  return (
    <>
      {launcherTarget ? createPortal(launcher, launcherTarget) : launcher}
      {open &&
        createPortal(
          <div ref={portalRef} className="modal-backdrop bug-report-backdrop" onKeyDown={keyboard}>
            <div
              ref={dialogRef}
              tabIndex={-1}
              className="modal bug-report-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="bug-report-title"
            >
              <div className="modal-header">
                <div>
                  <h2 id="bug-report-title">{draft ? t('reviewTitle') : t('launch')}</h2>
                  <p>{t('repository', { repository: metadata.repository })}</p>
                </div>
                {screen !== 'loading' && <LocaleSelector />}
                <button
                  className="icon-button"
                  aria-label={t('close')}
                  disabled={busy}
                  onClick={close}
                >
                  <X size={20} />
                </button>
              </div>
              <div className="modal-body form-stack">
                <p className="info-callout">{t('publicWarning')}</p>
                {!draft ? (
                  <BugReportFields
                    title={title}
                    description={description}
                    onTitleChange={setTitle}
                    onDescriptionChange={setDescription}
                    onChooseFiles={chooseFiles}
                  />
                ) : (
                  <BugReportPreview
                    draft={draft}
                    screenshotCount={screenshots.length}
                    disabled={sent || busy}
                    onDraftChange={(next) => {
                      setDraft(next);
                      setAcknowledged(false);
                    }}
                  />
                )}
                <BugReportScreenshots
                  screenshots={screenshots}
                  sent={sent}
                  busy={busy}
                  onRemove={(index) => {
                    URL.revokeObjectURL(screenshots[index].url);
                    setScreenshots(screenshots.filter((_, position) => position !== index));
                    if (draft) setDraft({ ...draft, submissionId: crypto.randomUUID() });
                    setAcknowledged(false);
                  }}
                />
                {draft && (
                  <label className="checkbox-line">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      disabled={sent || busy}
                      onChange={(event) => setAcknowledged(event.target.checked)}
                    />
                    {t('acknowledgment')}
                  </label>
                )}
                {error && (
                  <p className="error-text" role="alert">
                    {t(`errors.${error.code}`)}
                    {error.retryAfter ? ` ${t('retryAfter', { count: error.retryAfter })}` : ''}
                  </p>
                )}
                {status && <p role="status">{t(`statuses.${status}`)}</p>}
                {issueUrl && (
                  <a
                    className="text-link"
                    href={issueUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('issueLink')}
                  </a>
                )}
              </div>
              <div className="modal-footer">
                {!draft ? (
                  <button className="button primary" onClick={review}>
                    {t('review')}
                  </button>
                ) : (
                  <>
                    {!sent && (
                      <button
                        className="button secondary"
                        disabled={busy}
                        onClick={() => {
                          setDraft(null);
                          setAcknowledged(false);
                        }}
                      >
                        {t('edit')}
                      </button>
                    )}
                    {!issueUrl && (
                      <button
                        className="button primary"
                        disabled={!acknowledged || busy}
                        onClick={() => void deliver()}
                      >
                        {busy ? t('waiting') : sent ? t('checkStatus') : t('publish')}
                      </button>
                    )}
                    {issueUrl && (
                      <button className="button primary" onClick={close}>
                        {t('done')}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
