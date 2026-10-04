import { z } from 'zod';
import { ReportError, type ReportConfig } from './server-config';
import { GITHUB_ASSET_URL, isRepositoryIssueUrl } from './shared';

const assetSchema = z.object({ url: z.string().url() });
const issueSchema = z.object({ html_url: z.string().url(), body: z.string().nullable() });
export class GitHubFailure extends ReportError {
  constructor(public ambiguous: boolean, retryAfter?: number) { super(502, ambiguous ? 'DELIVERY_UNKNOWN' : 'GITHUB_FAILED', ambiguous ? 'GitHub submission status is unknown. Check status before trying again.' : 'GitHub could not accept the report. Your draft has been kept.', retryAfter); }
}
export function githubAdapter(config: ReportConfig) {
  async function call(url: string, init: RequestInit = {}, creating = false): Promise<Response> {
    try {
      const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(12_000), headers: {
        Authorization: `Bearer ${config.githubToken}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...init.headers,
      } });
      if (!response.ok) {
        const retry = Number(response.headers.get('retry-after'));
        throw new GitHubFailure(creating && response.status >= 500, retry > 0 && retry <= 86400 ? retry : undefined);
      }
      return response;
    } catch (cause) {
      if (cause instanceof GitHubFailure) throw cause;
      throw new GitHubFailure(creating);
    }
  }
  function issueUrl(url: string) {
    if (!isRepositoryIssueUrl(url, config.repository)) throw new GitHubFailure(true);
    return url;
  }
  return {
    async upload(bytes: Uint8Array, index: number): Promise<string> {
      const repoResponse = await call(`https://api.github.com/repos/${config.repository}`);
      const repo = z.object({ id: z.number().int().positive(), permissions: z.object({ push: z.literal(true) }) }).parse(await repoResponse.json());
      // Mirrors cli/cli internal/attachments/client.go; never accepts a client URL.
      const url = new URL('https://uploads.github.com/user-attachments/assets');
      url.search = new URLSearchParams({ repository_id: String(repo.id), name: `screenshot-${index + 1}.webp`, content_type: 'image/webp' }).toString();
      const response = await call(url.toString(), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: new Blob([new Uint8Array(bytes)]) });
      const asset = assetSchema.parse(await response.json());
      if (!GITHUB_ASSET_URL.test(asset.url)) throw new GitHubFailure(false);
      return asset.url;
    },
    async create(title: string, body: string): Promise<string> {
      const response = await call(`https://api.github.com/repos/${config.repository}/issues`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, body }) }, true);
      try { return issueUrl(issueSchema.parse(await response.json()).html_url); }
      catch { throw new GitHubFailure(true); }
    },
    async reconcile(submissionId: string, reporterId: string): Promise<string | null> {
      // Avoid the eventual-consistency delay of GitHub's search index.
      for (let page = 1; page <= 3; page++) {
        const response = await call(`https://api.github.com/repos/${config.repository}/issues?state=all&sort=created&direction=desc&per_page=100&page=${page}`);
        const issues = z.array(issueSchema).parse(await response.json());
        const found = issues.find((issue) => issue.body?.endsWith(`\n\n<!-- garage-bug-report:${reporterId}:${submissionId} -->`));
        if (found) return issueUrl(found.html_url);
        if (issues.length < 100) break;
      }
      return null;
    },
  };
}
export type GitHubAdapter = ReturnType<typeof githubAdapter>;
