'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Bug, X } from 'lucide-react';
import { supabase } from '@/lib/repository';
import { clearDiagnostics, recentDiagnostics, startDiagnostics } from '@/lib/bug-reports/diagnostics';
import { IMAGE_TYPES, PUBLIC_WARNING, REPORT_LIMITS, SUBMISSION_RETENTION_MS, formatIssue, issueTitle, publicMetadataSchema, reportSchema, type BugReport, type PublicMetadata, type ReportContext } from '@/lib/bug-reports/shared';

async function authenticatedFetch(url: string, init: RequestInit = {}) {
  const { data } = await supabase!.auth.getSession();
  if (!data.session) throw new Error('Sign in again to submit your report.');
  return fetch(url, { ...init, cache: 'no-store', headers: { ...init.headers, Authorization: `Bearer ${data.session.access_token}` } });
}
type Screenshot = { file: File; url: string };
function trapFocus(event: KeyboardEvent, root: Element | null) {
  if (event.key !== 'Tab') return;
  const controls = root?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]');
  if (!controls?.length) return;
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
export function BugReporter({ userId, screen, dialog: appDialog }: { userId?: string; screen: ReportContext['screen']; dialog: ReportContext['dialog'] }) {
  const [metadata, setMetadata] = useState<PublicMetadata | null>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const filesRef = useRef<Screenshot[]>([]);
  const [draft, setDraft] = useState<BugReport | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [sent, setSent] = useState(false);
  const firstAttempt = useRef(0);
  const confirmedPending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [issueUrl, setIssueUrl] = useState('');
  const [launcherTarget, setLauncherTarget] = useState<Element | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userId || !supabase) return;
    let active = true;
    void authenticatedFetch('/api/bug-reports/config').then(async (response) => {
      if (!response.ok) return;
      const result = await response.json();
      const parsed = publicMetadataSchema.safeParse(result.metadata);
      if (active && result.enabled === true && parsed.success) setMetadata(parsed.data);
    }).catch(() => { /* Reporting never interrupts the garage. */ });
    return () => { active = false; clearDiagnostics(); };
  }, [userId]);
  useEffect(() => { if (metadata && userId) return startDiagnostics(); }, [metadata, userId]);
  useEffect(() => { setLauncherTarget(appDialog === 'none' ? null : document.querySelector('.modal:not(.bug-report-modal)')); }, [appDialog, metadata]);
  useEffect(() => { filesRef.current = screenshots; }, [screenshots]);
  useEffect(() => () => { filesRef.current.forEach((item) => URL.revokeObjectURL(item.url)); }, []);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const siblings = [...document.body.children].filter((element) => element !== portalRef.current) as HTMLElement[];
    const inert = siblings.map((element) => element.inert);
    siblings.forEach((element) => { element.inert = true; });
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (dialogRef.current?.querySelector<HTMLElement>('input:not(:disabled)') ?? dialogRef.current)?.focus();
    return () => {
      siblings.forEach((element, index) => { element.inert = inert[index]; });
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
      else document.querySelector<HTMLElement>('.bug-report-launcher')?.focus();
    };
  }, [open]);

  if (!metadata || !userId) return null;
  const close = () => { if (!busy) setOpen(false); };
  function reset() {
    screenshots.forEach((item) => URL.revokeObjectURL(item.url));
    setScreenshots([]); setTitle(''); setDescription(''); setDraft(null); setAcknowledged(false); setSent(false); setIssueUrl(''); setStatus(''); setError('');
  }
  function keyboard(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    trapFocus(event, dialogRef.current);
  }
  function chooseFiles(files: FileList | null) {
    if (!files) return;
    const selected = Array.from(files);
    if (screenshots.length + selected.length > 2 || selected.some((file) => !IMAGE_TYPES.includes(file.type as typeof IMAGE_TYPES[number]) || file.size > REPORT_LIMITS.file || !file.size)) {
      setError('Attach at most two PNG, JPEG or WebP screenshots, each up to 1.5 MiB.'); return;
    }
    setError('');
    setScreenshots((current) => [...current, ...selected.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  }
  function review() {
    const candidate = reportSchema.safeParse({ submissionId: crypto.randomUUID(), title, description, acknowledged: true, metadata,
      context: { pathname: window.location.pathname, screen, dialog: appDialog, viewport: { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio || 1 }, locale: navigator.language, online: navigator.onLine }, diagnostics: recentDiagnostics() });
    if (!candidate.success) { setError('Enter a title of 5–120 characters and a description of 10–5,000 characters.'); return; }
    setDraft(candidate.data); setAcknowledged(false); setSent(false); setError(''); setStatus(''); setIssueUrl('');
  }
  async function deliver(check = false) {
    if (!draft || !acknowledged || busy) return;
    setBusy(true); setError('');
    try {
      const data = new FormData();
      data.append('report', JSON.stringify(draft));
      screenshots.forEach((item) => data.append('screenshots', item.file));
      // Once a transport failure is possible, check the receipt before reposting.
      const checking = check || sent;
      if (!checking) { firstAttempt.current = Date.now(); confirmedPending.current = false; }
      setSent(true);
      const response = await authenticatedFetch(checking ? `/api/bug-reports/${draft.submissionId}` : '/api/bug-reports', checking ? {} : { method: 'POST', body: data });
      const result = await response.json();
      if (!response.ok) {
        if (checking && response.status === 404 && (confirmedPending.current || Date.now() - firstAttempt.current >= SUBMISSION_RETENTION_MS)) {
          throw new Error('The submission record is no longer available, so publication cannot be confirmed. Check GitHub before starting another report.');
        }
        if ([401, 404, 413, 415, 422, 429].includes(response.status) || result.code === 'GITHUB_FAILED' || result.code === 'LIMITER_UNAVAILABLE') setSent(false);
        if (result.code === 'PREVIEW_CHANGED') {
          const fresh = await authenticatedFetch('/api/bug-reports/config');
          const configuration = await fresh.json();
          const parsed = publicMetadataSchema.safeParse(configuration.metadata);
          if (fresh.ok && configuration.enabled === true && parsed.success) { setMetadata(parsed.data); setDraft(null); setAcknowledged(false); setSent(false); }
        }
        const wait = response.headers.get('retry-after');
        throw new Error(`${typeof result.error === 'string' ? result.error : 'Could not submit the report.'}${wait ? ` Try again in ${wait} seconds.` : ''}`);
      }
      if (result.state === 'succeeded' && typeof result.issueUrl === 'string' && result.issueUrl.startsWith(`https://github.com/${metadata!.repository}/issues/`)) {
        setIssueUrl(result.issueUrl); setStatus('Your report was published.');
      } else if (result.state === 'failed') { setSent(false); setStatus('Submission failed. You can retry this reviewed draft.'); }
      else { confirmedPending.current = true; setStatus('Submission is pending or its status is unknown. Check status before starting another report.'); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not submit. Your draft has been kept.'); }
    finally { setBusy(false); }
  }

  // Portal events follow React ownership, so bridge the underlying modal's Tab trap.
  const launcher = <button className="button secondary bug-report-launcher" onKeyDown={(event) => trapFocus(event, launcherTarget)} onClick={() => { if (issueUrl) reset(); setOpen(true); }}><Bug size={16} />Report a bug</button>;
  return <>
    {launcherTarget ? createPortal(launcher, launcherTarget) : launcher}
    {open && createPortal(<div ref={portalRef} className="modal-backdrop bug-report-backdrop" onKeyDown={keyboard}>
      <div ref={dialogRef} tabIndex={-1} className="modal bug-report-modal" role="dialog" aria-modal="true" aria-labelledby="bug-report-title">
        <div className="modal-header"><div><h2 id="bug-report-title">{draft ? 'Review your public report' : 'Report a bug'}</h2><p>Published to {metadata.repository}</p></div><button className="icon-button" aria-label="Close bug report" disabled={busy} onClick={close}><X size={20} /></button></div>
        <div className="modal-body form-stack">
          <p className="info-callout">{PUBLIC_WARNING}</p>
          {!draft ? <>
            <label>Title<input value={title} minLength={5} maxLength={120} onChange={(event) => setTitle(event.target.value)} /></label>
            <label>Description<textarea rows={7} value={description} minLength={10} maxLength={5000} onChange={(event) => setDescription(event.target.value)} placeholder={'Steps to reproduce:\n\nExpected behavior:\n\nActual behavior:'} /></label>
            <label htmlFor="bug-report-screenshots">Screenshots (optional)</label><input id="bug-report-screenshots" aria-describedby="bug-report-file-help" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={(event) => { chooseFiles(event.target.files); event.target.value = ''; }} /><p id="bug-report-file-help" className="field-help">Up to two images, 1.5 MiB each. Remove private details before uploading. Screenshots are published only after you submit.</p>
          </> : <>
            <h3>{issueTitle(draft.title)}</h3>
            <details open><summary>Complete public issue text</summary><pre className="bug-report-preview">{formatIssue(draft, screenshots.map(() => ''))}</pre></details>
            <fieldset className="bug-report-diagnostics" disabled={sent || busy}><legend>Included recent errors</legend>
              <p className="field-help">Redaction is best-effort. Inspect these entries and remove anything private.</p>
              {draft.diagnostics.map((entry, index) => <div className="bug-report-diagnostic" key={`${entry.timestamp}-${index}`}><pre>{entry.message}{entry.stack ? `\n${entry.stack}` : ''}</pre><button className="button secondary" onClick={() => { setDraft({ ...draft, submissionId: crypto.randomUUID(), diagnostics: draft.diagnostics.filter((_, position) => position !== index) }); setAcknowledged(false); }}>Remove error {index + 1}</button></div>)}
              <button className="text-link" disabled={!draft.diagnostics.length} onClick={() => { setDraft({ ...draft, submissionId: crypto.randomUUID(), diagnostics: [] }); setAcknowledged(false); }}>Remove all diagnostics</button>
            </fieldset>
          </>}
          <div className="bug-report-screenshots">{screenshots.map((item, index) => <figure key={item.url}><img src={item.url} alt={`Screenshot ${index + 1} to include in the public report`} /><figcaption>Screenshot {index + 1}{!sent && <button className="text-link" disabled={busy} onClick={() => { URL.revokeObjectURL(item.url); setScreenshots(screenshots.filter((_, position) => position !== index)); if (draft) setDraft({ ...draft, submissionId: crypto.randomUUID() }); setAcknowledged(false); }}>Remove screenshot {index + 1}</button>}</figcaption></figure>)}</div>
          {draft && <label className="checkbox-line"><input type="checkbox" checked={acknowledged} disabled={sent || busy} onChange={(event) => setAcknowledged(event.target.checked)} />I understand: {PUBLIC_WARNING}</label>}
          {error && <p className="error-text" role="alert">{error}</p>}
          {status && <p role="status">{status}</p>}
          {issueUrl && <a className="text-link" href={issueUrl} target="_blank" rel="noopener noreferrer">View GitHub issue</a>}
        </div>
        <div className="modal-footer">
          {!draft ? <button className="button primary" onClick={review}>Review report</button> : <>
            {!sent && <button className="button secondary" disabled={busy} onClick={() => { setDraft(null); setAcknowledged(false); }}>Edit report</button>}
            {!issueUrl && <button className="button primary" disabled={!acknowledged || busy} onClick={() => void deliver()}>{busy ? 'Please wait…' : sent ? 'Check submission status' : 'Publish report'}</button>}
            {issueUrl && <button className="button primary" onClick={close}>Done</button>}
          </>}
        </div>
      </div>
    </div>, document.body)}
  </>;
}
