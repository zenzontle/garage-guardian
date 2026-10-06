import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import packageInfo from '../../../package.json';
import { publicMetadataSchema, redact, type PublicMetadata } from './shared';

export class ReportError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) { super(message); }
}
export type ReportConfig = {
  repository: string; githubToken: string; secret: string; redisUrl: string; redisToken: string;
  supabaseUrl: string; supabaseKey: string; environment: string; release: string; prefix: string;
};
export const reportingEnabled = () => process.env.BUG_REPORTS_ENABLED === 'true';
export function reportConfig(): ReportConfig {
  const repository = process.env.BUG_REPORT_GITHUB_REPOSITORY || 'zenzontle/garage-guardian';
  const environment = process.env.BUG_REPORT_ENVIRONMENT || process.env.VERCEL_ENV || 'development';
  const commit = process.env.VERCEL_GIT_COMMIT_SHA;
  const release = process.env.BUG_REPORT_RELEASE || `${packageInfo.version}+${commit || 'local'}`;
  const config = {
    repository, environment, release, githubToken: process.env.BUG_REPORT_GITHUB_TOKEN || '', secret: process.env.BUG_REPORT_HMAC_SECRET || '',
    redisUrl: process.env.UPSTASH_REDIS_REST_URL || '', redisToken: process.env.UPSTASH_REDIS_REST_TOKEN || '',
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '', supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '',
    prefix: `garage-guardian:bug-reports:${repository}:${environment}`,
  };
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[\w.-]{1,60}$/.test(environment) || release.length > 160 || /[\r\n]/.test(release)
    || config.secret.length < 32 || !config.githubToken || !config.redisToken || !config.supabaseKey
    || !validHttps(config.redisUrl) || !validHttps(config.supabaseUrl) || (process.env.VERCEL && !commit && !process.env.BUG_REPORT_RELEASE)) {
    throw new ReportError(503, 'NOT_CONFIGURED', 'Bug reporting is unavailable.');
  }
  return config;
}
function validHttps(value: string) { try { return new URL(value).protocol === 'https:'; } catch { return false; } }
export function identifier(config: ReportConfig, purpose: string, value: string) { return createHmac('sha256', config.secret).update(`${purpose}:${value}`).digest('hex'); }
export async function authenticate(request: Request, config: ReportConfig) {
  const match = /^Bearer ([^\s]+)$/.exec(request.headers.get('authorization') || '');
  if (!match || match[1].length > 8192) throw new ReportError(401, 'UNAUTHENTICATED', 'Sign in again to report this bug.');
  const client = createClient(config.supabaseUrl, config.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) } });
  let result;
  try { result = await client.auth.getUser(match[1]); }
  catch { throw new ReportError(503, 'AUTH_UNAVAILABLE', 'Account verification is unavailable. Try again later.'); }
  if (result.error && result.error.status && result.error.status >= 500) throw new ReportError(503, 'AUTH_UNAVAILABLE', 'Account verification is unavailable. Try again later.');
  if (result.error || !result.data.user || result.data.user.is_anonymous) throw new ReportError(401, 'UNAUTHENTICATED', 'Sign in again to report this bug.');
  return result.data.user.id;
}
export function publicMetadata(request: Request, config: ReportConfig, userId: string): PublicMetadata {
  return publicMetadataSchema.parse({ release: config.release, environment: config.environment, repository: config.repository,
    reporterId: `reporter-${identifier(config, 'reporter', userId).slice(0, 24)}`, browserOS: redact(request.headers.get('user-agent') || 'Unknown').slice(0, 512) });
}
export function clientIp(request: Request): string {
  // Never accept client-selected forwarding headers on a non-Vercel production host.
  if (!process.env.VERCEL && process.env.NODE_ENV !== 'production') return '127.0.0.1';
  if (!process.env.VERCEL) throw new ReportError(503, 'IP_UNAVAILABLE', 'Bug reporting requires a trusted deployment proxy.');
  let ip = (request.headers.get('x-vercel-forwarded-for') || '').trim().toLowerCase();
  if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  const kind = isIP(ip);
  if (!kind) throw new ReportError(503, 'IP_UNAVAILABLE', 'Could not verify the request address.');
  return kind === 6 ? new URL(`http://[${ip}]/`).hostname.slice(1, -1) : ip;
}
export function errorResponse(cause: unknown): Response {
  const error = cause instanceof ReportError ? cause : new ReportError(503, 'UNAVAILABLE', 'Bug reporting is unavailable. Your draft has been kept.');
  return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: { 'Cache-Control': 'no-store', ...(error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {}) } });
}
