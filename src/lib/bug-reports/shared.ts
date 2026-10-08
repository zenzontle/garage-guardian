import { reportPaths } from '../garage-routes';
import { z } from 'zod';

export const REPORT_LIMITS = {
  file: 1.5 * 1024 * 1024,
  body: 3.25 * 1024 * 1024,
  pixels: 20_000_000,
  issueBody: 65_536,
  assetUrl: 2048,
};
export const SUBMISSION_RETENTION_MS = 24 * 60 * 60_000;
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const GITHUB_ASSET_URL = /^https:\/\/github\.com\/user-attachments\/assets\/[A-Za-z0-9-]+$/;
export function isRepositoryIssueUrl(value: string, repository: string): boolean {
  try {
    const url = new URL(value);
    const [, owner, repo, kind, number, extra] = url.pathname.split('/');
    return (
      url.origin === 'https://github.com' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      `${owner}/${repo}`.toLowerCase() === repository.toLowerCase() &&
      kind === 'issues' &&
      /^\d+$/.test(number ?? '') &&
      extra === undefined
    );
  } catch {
    return false;
  }
}
const text = (max: number) =>
  z
    .string()
    .max(max)
    .refine(
      // eslint-disable-next-line no-control-regex -- Reject non-printable input while allowing tabs and line breaks.
      (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
      'Invalid control characters',
    );
export const publicMetadataSchema = z.strictObject({
  release: text(160),
  environment: text(60),
  repository: text(100),
  reporterId: z.string().regex(/^reporter-[a-f0-9]{24}$/),
  browserOS: text(512),
});
export type PublicMetadata = z.infer<typeof publicMetadataSchema>;
export const diagnosticSchema = z.strictObject({
  source: z.enum(['console', 'browser', 'rejection', 'operation']),
  timestamp: z.number().int().nonnegative(),
  message: text(1000),
  stack: text(2000),
});
export type Diagnostic = z.infer<typeof diagnosticSchema>;
export const contextSchema = z.strictObject({
  pathname: z.enum(reportPaths),
  screen: z.enum(['dashboard', 'cars', 'history', 'reports', 'loading', 'recovery']),
  dialog: z.enum(['none', 'add-car', 'edit-car', 'schedule', 'visit']),
  viewport: z.strictObject({
    width: z.number().int().min(1).max(32768),
    height: z.number().int().min(1).max(32768),
    pixelRatio: z.number().finite().min(0.1).max(10),
  }),
  locale: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[A-Za-z0-9_-]+$/),
  online: z.boolean(),
});
export type ReportContext = z.infer<typeof contextSchema>;
export const reportSchema = z.strictObject({
  submissionId: z.uuid(),
  title: text(120).trim().min(5),
  description: text(5000).trim().min(10),
  acknowledged: z.literal(true),
  metadata: publicMetadataSchema,
  context: contextSchema,
  diagnostics: z.array(diagnosticSchema).max(20),
});
export type BugReport = z.infer<typeof reportSchema>;

export function redact(value: string): string {
  return (
    value
      .replace(/https?:\/\/[^\s<>"']+/gi, (url) => {
        try {
          const parsed = new URL(url);
          // Replacing an IPv6 host with [IP] would create an invalid URL on re-cleaning.
          if (parsed.hostname.startsWith('[')) return '[URL]';
          parsed.username = '';
          parsed.password = '';
          parsed.search = '';
          parsed.hash = '';
          return parsed.toString();
        } catch {
          return '[URL]';
        }
      })
      .replace(/(?:\/|\.\.?\/)[^\s<>"']*[?#][^\s<>"']*/g, (path) => path.split(/[?#]/, 1)[0])
      .replace(
        /(^|[^\w:])([\da-f:][\da-f:.]*:[\da-f:.]*(?:%[\w.~-]+)?)(?![\w:%])/gi,
        (match, prefix: string, candidate: string) => {
          const address = candidate.replace(/\.+$/, '');
          try {
            // WHATWG URL validates compressed and IPv4-mapped IPv6 in both runtimes.
            // A scope identifies the interface; redact it along with the address.
            new URL(`http://[${address.split('%', 1)[0]}]/`);
            return `${prefix}[IP]${candidate.slice(address.length)}`;
          } catch {
            return match;
          }
        },
      )
      .replace(
        /\b([A-Za-z][\w-]*\/)?((?:\d{1,3}\.){3}\d{1,3})\b/g,
        (match, prefix: string | undefined, address: string) => {
          if (
            prefix &&
            /^(?:Chrome|Chromium|HeadlessChrome|CriOS|Firefox|FxiOS|Safari|Version|Edg|EdgA|EdgiOS|OPR|Opera)\/$/i.test(
              prefix,
            )
          )
            return match;
          return address.split('.').every((part) => Number(part) <= 255)
            ? `${prefix ?? ''}[IP]`
            : match;
        },
      )
      // Consume escaped/multiline quotes in full, including values cut off by capture.
      .replace(
        /\b(password|passwd|(?:access_|refresh_)?token|secret|api[_-]?key|authorization|cookie)["']?\s*[:=]\s*(?:\[REDACTED\]|"(?:\\[\s\S]|[^"\\])*(?:"|\\?$)|'(?:\\[\s\S]|[^'\\])*(?:'|\\?$)|(?:Basic|Bearer|Digest|Negotiate)\s+[^\r\n]+|[^\s,;"']+)/gi,
        '$1=[REDACTED]',
      )
      // After quoted-value cleaning, remove every cookie pair through the end of the header line.
      .replace(/\b(cookie)[ \t]*[:=][^\r\n]*/gi, '$1=[REDACTED]')
      .replace(/\b(?:Bearer\s+)[\w.\-+/=]+/gi, 'Bearer [REDACTED]')
      .replace(/\b(?:eyJ[\w-]+\.[\w-]+\.[\w-]+|(?:gh[pousr]_|github_pat_)[\w]+)\b/g, '[TOKEN]')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
      .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[ID]')
      .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, '[VIN]')
      // eslint-disable-next-line no-control-regex -- Remove non-printable characters from public diagnostics.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  );
}

export function cleanDiagnostic(entry: Diagnostic): Diagnostic {
  return {
    ...entry,
    message: redact(entry.message).slice(0, 1000),
    stack: redact(entry.stack).slice(0, 2000),
  };
}

// Fences longer than any user-supplied run keep HTML, mentions and Markdown inert.
function literal(value: string) {
  const fence = '`'.repeat(
    Math.max(3, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length + 1)),
  );
  return `${fence}text\n${value}\n${fence}`;
}
export function issueTitle(title: string) {
  return `[Bug] ${title.replace(/@/g, '@\u200b').replace(/[<>]/g, '')}`;
}
export function formatIssue(report: BugReport, screenshots: string[] = []): string {
  const { metadata: m, context: c } = report;
  const details = `Release: ${m.release}\nEnvironment: ${m.environment}\nReporter: ${m.reporterId}\nBrowser / OS: ${m.browserOS}\nRoute: ${c.pathname}\nScreen: ${c.screen}\nDialog: ${c.dialog}\nViewport: ${c.viewport.width} × ${c.viewport.height} (${c.viewport.pixelRatio}x)\nLocale: ${c.locale}\nOnline: ${c.online}`;
  const errors = report.diagnostics
    .map(
      (entry) =>
        `${new Date(entry.timestamp).toISOString()} [${entry.source}] ${entry.message}${entry.stack ? `\n${entry.stack}` : ''}`,
    )
    .join('\n\n');
  return `## Description\n${literal(report.description)}\n\n## App context\n${literal(details)}\n\n## Recent errors\n${literal(errors || 'No errors included.')}\n\n## Screenshots\n${screenshots.length ? screenshots.map((url, index) => (url ? `![Screenshot ${index + 1}](${url})` : `Screenshot ${index + 1} (reviewed attachment)`)).join('\n\n') : 'No screenshots included.'}\n\n<!-- garage-bug-report:${m.reporterId}:${report.submissionId} -->`;
}
export function fitsIssueBody(report: BugReport): boolean {
  // Reserve two maximum-length asset URLs so the public preview and final body fit.
  return (
    formatIssue(report, Array(2).fill('x'.repeat(REPORT_LIMITS.assetUrl))).length <=
    REPORT_LIMITS.issueBody
  );
}
