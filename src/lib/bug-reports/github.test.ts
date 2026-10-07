// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { githubAdapter } from './github';
import { config } from './fixtures.test-helper';
import { REPORT_LIMITS } from './shared';

describe('isolated GitHub adapter', () => {
  it('accepts canonical repository casing on creation and reconciliation', async () => {
    const url = 'https://github.com/zenzontle/garage-guardian/issues/12';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ html_url: url, body: 'report' }))
        .mockResolvedValueOnce(
          Response.json([
            { html_url: url, body: '\n\n<!-- garage-bug-report:reporter-test:abc -->' },
          ]),
        ),
    );
    const github = githubAdapter({ ...config, repository: 'ZenZontle/Garage-Guardian' });
    expect(await github.create('title', 'report')).toBe(url);
    expect(await github.reconcile('abc', 'reporter-test')).toBe(url);
  });
  it('uploads with the configured repository ID and a generic filename', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ id: 123, permissions: { push: true } }))
      .mockResolvedValueOnce(
        Response.json({ url: 'https://github.com/user-attachments/assets/abc' }),
      );
    vi.stubGlobal('fetch', fetch);
    expect(await githubAdapter(config).upload(new Uint8Array([1]), 0)).toBe(
      'https://github.com/user-attachments/assets/abc',
    );
    const url = new URL(fetch.mock.calls[1][0]);
    expect(url.origin).toBe('https://uploads.github.com');
    expect(url.searchParams.get('repository_id')).toBe('123');
    expect(url.searchParams.get('name')).toBe('screenshot-1.webp');
  });
  it('rejects unexpected asset hosts and never forwards credentials through redirects', async () => {
    for (const url of [
      'https://evil.test/file',
      'https://github.com/user-attachments/assets/x)@mention',
      'https://github.com/user-attachments/assets/abc?secret=private',
      `https://github.com/user-attachments/assets/${'a'.repeat(REPORT_LIMITS.assetUrl)}`,
    ]) {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ id: 123, permissions: { push: true } }))
        .mockResolvedValueOnce(Response.json({ url }));
      vi.stubGlobal('fetch', fetch);
      await expect(githubAdapter(config).upload(new Uint8Array([1]), 0)).rejects.toHaveProperty(
        'status',
        502,
      );
      expect(fetch.mock.calls.every((call) => call[1].redirect === 'error')).toBe(true);
    }
  });
  it('treats network errors and 5xx creation as ambiguous, but 429 as a known failure', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    fetch.mockRejectedValueOnce(new Error('timeout'));
    await expect(githubAdapter(config).create('title', 'body')).rejects.toHaveProperty(
      'ambiguous',
      true,
    );
    fetch.mockResolvedValueOnce(new Response('', { status: 503 }));
    await expect(githubAdapter(config).create('title', 'body')).rejects.toHaveProperty(
      'ambiguous',
      true,
    );
    fetch.mockResolvedValueOnce(
      new Response('', { status: 429, headers: { 'Retry-After': '60' } }),
    );
    await expect(githubAdapter(config).create('title', 'body')).rejects.toMatchObject({
      ambiguous: false,
      retryAfter: 60,
    });
  });
  it('reconciles against issue bodies rather than search-index results', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(
      Response.json([
        {
          html_url: 'https://github.com/zenzontle/garage-guardian/issues/2',
          body: '\n\n<!-- garage-bug-report:reporter-test:abc -->',
        },
      ]),
    );
    vi.stubGlobal('fetch', fetch);
    expect(await githubAdapter(config).reconcile('abc', 'reporter-test')).toBe(
      'https://github.com/zenzontle/garage-guardian/issues/2',
    );
    expect(fetch.mock.calls[0][0]).toContain('/issues?state=all');
  });
  it('ignores markers in user descriptions and markers belonging to another reporter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        Response.json([
          {
            html_url: 'https://github.com/zenzontle/garage-guardian/issues/2',
            body: '<!-- garage-bug-report:reporter-one:abc -->\n\nother text',
          },
          {
            html_url: 'https://github.com/zenzontle/garage-guardian/issues/3',
            body: '\n\n<!-- garage-bug-report:reporter-two:abc -->',
          },
        ]),
      ),
    );
    expect(await githubAdapter(config).reconcile('abc', 'reporter-one')).toBeNull();
  });
});
