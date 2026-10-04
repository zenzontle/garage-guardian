import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { IMAGE_TYPES, REPORT_LIMITS, cleanDiagnostic, formatIssue, issueTitle, reportSchema, type BugReport, type PublicMetadata } from './shared';
import { ReportError } from './server-config';
import { GitHubFailure, type GitHubAdapter } from './github';
import type { Receipt, ReportStore } from './store';

export async function readReport(request: Request, metadata: PublicMetadata): Promise<{ report: BugReport; images: Uint8Array[]; hash: string }> {
  const contentType = request.headers.get('content-type') || '';
  if (!/^multipart\/form-data;\s*boundary=/i.test(contentType)) throw new ReportError(415, 'INVALID_MEDIA', 'Send a multipart report.');
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > REPORT_LIMITS.body)) throw new ReportError(413, 'PAYLOAD_TOO_LARGE', 'The report is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new ReportError(422, 'INVALID_REPORT', 'The report is empty.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > REPORT_LIMITS.body) { await reader.cancel(); throw new ReportError(413, 'PAYLOAD_TOO_LARGE', 'The report is too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  let form: FormData;
  try { form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': contentType } }).formData(); }
  catch { throw new ReportError(422, 'INVALID_REPORT', 'The report is malformed.'); }
  if ([...form.keys()].some((key) => key !== 'report' && key !== 'screenshots') || form.getAll('report').length !== 1 || typeof form.get('report') !== 'string') throw new ReportError(422, 'INVALID_REPORT', 'Unexpected report fields.');
  let report: BugReport;
  try { report = reportSchema.parse(JSON.parse(form.get('report') as string)); }
  catch { throw new ReportError(422, 'INVALID_REPORT', 'Check the report text and diagnostic fields.'); }
  if (JSON.stringify(report.metadata) !== JSON.stringify(metadata)) throw new ReportError(409, 'PREVIEW_CHANGED', 'Deployment or account details changed. Reopen the report and review it again.');
  const sanitized = report.diagnostics.map(cleanDiagnostic);
  if (JSON.stringify(sanitized) !== JSON.stringify(report.diagnostics)) throw new ReportError(422, 'UNSAFE_DIAGNOSTICS', 'Remove sensitive diagnostic entries before submitting.');
  const now = Date.now();
  if (report.diagnostics.some((entry) => entry.timestamp > now + 60_000 || entry.timestamp < now - 24 * 60 * 60_000)) throw new ReportError(422, 'INVALID_REPORT', 'Diagnostic timestamps are invalid.');
  const files = form.getAll('screenshots');
  if (files.length > 2) throw new ReportError(422, 'INVALID_FILES', 'Attach at most two screenshots.');
  const images: Uint8Array[] = [];
  const hash = createHash('sha256').update(JSON.stringify(report));
  for (const file of files) {
    if (typeof file === 'string' || !IMAGE_TYPES.includes(file.type as typeof IMAGE_TYPES[number]) || !file.size || file.size > REPORT_LIMITS.file) throw new ReportError(422, 'INVALID_FILES', 'Use PNG, JPEG or WebP screenshots up to 1.5 MiB each.');
    const bytes = Buffer.from(await file.arrayBuffer());
    hash.update(bytes);
    try {
      const image = sharp(bytes, { limitInputPixels: REPORT_LIMITS.pixels, animated: false, failOn: 'warning' });
      const info = await image.metadata();
      const formats: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' };
      if (info.format !== formats[file.type] || (info.pages ?? 1) !== 1) throw new Error('Invalid image');
      const clean = await image.rotate().webp({ quality: 90 }).toBuffer();
      if (clean.length > REPORT_LIMITS.file) throw new Error('Image too large');
      images.push(clean);
    } catch { throw new ReportError(422, 'INVALID_FILES', 'A screenshot is corrupted, too large, animated, or has an incorrect file type.'); }
  }
  return { report, images, hash: hash.digest('hex') };
}

export function receiptResponse(receipt: Receipt): Response {
  return Response.json({ state: receipt.state, ...(receipt.issueUrl ? { issueUrl: receipt.issueUrl } : {}) }, { status: receipt.state === 'succeeded' ? 201 : 202, headers: { 'Cache-Control': 'no-store' } });
}
export async function reconcileReceipt(store: ReportStore, github: GitHubAdapter, userId: string, submissionId: string, receipt: Receipt, reporterId: string) {
  if (receipt.state !== 'creating' && receipt.state !== 'unknown') return receipt;
  const issueUrl = await github.reconcile(submissionId, reporterId);
  const updated: Receipt = { ...receipt, state: issueUrl ? 'succeeded' : 'unknown', ...(issueUrl ? { issueUrl } : {}) };
  await store.save(userId, submissionId, updated);
  return updated;
}
export async function submitReport(store: ReportStore, github: GitHubAdapter, userId: string, ip: string, input: Awaited<ReturnType<typeof readReport>>): Promise<Response> {
  const { report, images, hash } = input;
  const id = report.submissionId;
  let receipt = await store.get(userId, id);
  if (receipt) {
    if (receipt.hash !== hash) throw new ReportError(409, 'DRAFT_CHANGED', 'This submission was already sent with different content. Start a new reviewed report.');
    if (receipt.state === 'succeeded') return receiptResponse(receipt);
    if (receipt.state === 'creating' || receipt.state === 'unknown') return receiptResponse(await reconcileReceipt(store, github, userId, id, receipt, report.metadata.reporterId));
  }
  if (!(await store.lock(userId, id))) throw new ReportError(409, 'IN_PROGRESS', 'This report is already being submitted. Check its status.');
  try {
    // Re-read under the lock; another worker may have finished between get and lock.
    receipt = await store.get(userId, id);
    if (receipt && receipt.hash !== hash) throw new ReportError(409, 'DRAFT_CHANGED', 'The submission content changed.');
    if (receipt && ['succeeded', 'creating', 'unknown'].includes(receipt.state)) return receiptResponse(await reconcileReceipt(store, github, userId, id, receipt, report.metadata.reporterId));
    await store.limit(userId, ip);
    if (!receipt) {
      receipt = { hash, state: 'uploading', assets: [], createdAt: Date.now() };
      if (!(await store.claim(userId, id, receipt))) throw new ReportError(409, 'IN_PROGRESS', 'The report is already being submitted.');
    }
    receipt.state = 'uploading';
    try {
      for (let index = receipt.assets.length; index < images.length; index++) {
        receipt.assets.push(await github.upload(images[index], index));
        await store.save(userId, id, receipt);
      }
    } catch (cause) {
      receipt.state = 'failed';
      await store.save(userId, id, receipt);
      throw cause;
    }
    // Persist BEFORE calling GitHub. A process exit leaves an ambiguous receipt,
    // never an invitation for a retry to create another issue.
    receipt.state = 'creating';
    await store.save(userId, id, receipt);
    try {
      const issueUrl = await github.create(issueTitle(report.title), formatIssue(report, receipt.assets));
      receipt = { ...receipt, state: 'succeeded', issueUrl };
      await store.save(userId, id, receipt);
      return receiptResponse(receipt);
    } catch (cause) {
      receipt.state = cause instanceof GitHubFailure && !cause.ambiguous ? 'failed' : 'unknown';
      await store.save(userId, id, receipt);
      if (receipt.state === 'unknown') return receiptResponse(receipt);
      throw cause;
    }
  } finally { await store.unlock(userId, id); }
}
