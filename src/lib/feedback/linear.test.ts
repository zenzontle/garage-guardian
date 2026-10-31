// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { linearAdapter } from './linear';
import { config } from './fixtures.test-helper';
import { REPORT_LIMITS } from './shared';

const assetUrl = 'https://uploads.linear.app/org-id/file-id/asset-id';
function uploadResponse(overrides: Record<string, unknown> = {}) {
  return Response.json({
    data: {
      fileUpload: {
        success: true,
        uploadFile: {
          uploadUrl: 'https://storage.example.test/signed-upload',
          assetUrl,
          headers: [{ key: 'x-goog-content-length-range', value: '1,1' }],
          ...overrides,
        },
      },
    },
  });
}
function body(call: unknown[]) {
  return JSON.parse((call[1] as RequestInit).body as string);
}

describe('isolated Linear adapter', () => {
  it('uploads through a signed URL without forwarding the API key', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(uploadResponse())
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect(await linearAdapter(config).upload(new Uint8Array([1, 2, 3]), 1)).toBe(assetUrl);
    const [graphqlUrl, graphqlInit] = fetch.mock.calls[0];
    expect(graphqlUrl).toBe('https://api.linear.app/graphql');
    expect(graphqlInit.headers.Authorization).toBe(config.linearApiKey);
    expect(body(fetch.mock.calls[0]).variables).toEqual({
      contentType: 'image/webp',
      filename: 'screenshot-2.webp',
      size: 3,
    });
    const [uploadUrl, uploadInit] = fetch.mock.calls[1];
    expect(uploadUrl).toBe('https://storage.example.test/signed-upload');
    expect(uploadInit.method).toBe('PUT');
    const headers = uploadInit.headers as Headers;
    expect(headers.get('content-type')).toBe('image/webp');
    expect(headers.get('x-goog-content-length-range')).toBe('1,1');
    expect(headers.has('authorization')).toBe(false);
    expect(fetch.mock.calls.every((call) => call[1].redirect === 'error')).toBe(true);
    expect(fetch.mock.calls.every((call) => call[1].signal instanceof AbortSignal)).toBe(true);
  });
  it('rejects unexpected asset URLs and non-HTTPS upload targets before sending bytes', async () => {
    for (const overrides of [
      { assetUrl: 'https://evil.test/file' },
      { assetUrl: 'https://github.com/user-attachments/assets/abc' },
      { assetUrl: 'https://uploads.linear.app/org/file)@mention' },
      { assetUrl: 'https://uploads.linear.app/org/file?token=private' },
      { assetUrl: `https://uploads.linear.app/${'a'.repeat(REPORT_LIMITS.assetUrl)}` },
      { uploadUrl: 'http://storage.example.test/signed-upload' },
    ]) {
      const fetch = vi.fn().mockResolvedValueOnce(uploadResponse(overrides));
      vi.stubGlobal('fetch', fetch);
      await expect(linearAdapter(config).upload(new Uint8Array([1]), 0)).rejects.toMatchObject({
        status: 502,
        code: 'DELIVERY_FAILED',
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it('treats GraphQL errors as known failures', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    fetch.mockResolvedValueOnce(
      Response.json({ data: null, errors: [{ message: 'Argument Validation Error' }] }),
    );
    await expect(linearAdapter(config).upload(new Uint8Array([1]), 0)).rejects.toMatchObject({
      ambiguous: false,
      code: 'DELIVERY_FAILED',
    });
    fetch.mockResolvedValueOnce(
      Response.json({ data: null, errors: [{ message: 'Team not found' }] }),
    );
    await expect(
      linearAdapter(config).create('title', 'body', crypto.randomUUID()),
    ).rejects.toMatchObject({ ambiguous: false, code: 'DELIVERY_FAILED' });
    fetch.mockResolvedValueOnce(Response.json({ errors: [{ message: 'Forbidden' }] }));
    await expect(linearAdapter(config).reconcile(crypto.randomUUID())).rejects.toHaveProperty(
      'ambiguous',
      false,
    );
  });
  it('creates the issue with the chosen ID and team and returns its identifier', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ data: { issueCreate: { success: true, issue: { identifier: 'FB-12' } } } }),
      );
    vi.stubGlobal('fetch', fetch);
    const issueId = linearAdapter(config).issueId('user', 'submission');
    expect(await linearAdapter(config).create('[Feedback] title', 'description', issueId)).toBe(
      'FB-12',
    );
    expect(body(fetch.mock.calls[0]).variables).toEqual({
      input: {
        id: issueId,
        teamId: config.linearTeamId,
        title: '[Feedback] title',
        description: 'description',
      },
    });
  });
  it('returns the existing issue when a retry is rejected because its ID already exists', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ data: null, errors: [{ message: 'already exists' }] }))
      .mockResolvedValueOnce(
        Response.json({ data: { issues: { nodes: [{ identifier: 'FB-12' }] } } }),
      )
      .mockResolvedValueOnce(Response.json({ data: null, errors: [{ message: 'invalid' }] }))
      .mockResolvedValueOnce(Response.json({ data: { issues: { nodes: [] } } }));
    vi.stubGlobal('fetch', fetch);
    const issueId = crypto.randomUUID();
    expect(await linearAdapter(config).create('title', 'body', issueId)).toBe('FB-12');
    expect(body(fetch.mock.calls[1]).variables.id).toBe(issueId);
    await expect(linearAdapter(config).create('title', 'body', issueId)).rejects.toMatchObject({
      ambiguous: false,
      code: 'DELIVERY_FAILED',
    });
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it('treats timeouts, 5xx and unreadable creation results as uncertain, but 429 as known', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const create = () => linearAdapter(config).create('title', 'body', crypto.randomUUID());
    fetch.mockRejectedValueOnce(new DOMException('timed out', 'TimeoutError'));
    await expect(create()).rejects.toMatchObject({ ambiguous: true, code: 'DELIVERY_UNKNOWN' });
    fetch.mockResolvedValueOnce(new Response('', { status: 503 }));
    await expect(create()).rejects.toHaveProperty('ambiguous', true);
    fetch.mockResolvedValueOnce(new Response('not json', { status: 200 }));
    await expect(create()).rejects.toHaveProperty('ambiguous', true);
    fetch.mockResolvedValueOnce(
      Response.json({
        data: { issueCreate: { success: true, issue: { identifier: 'https://linear.app/x' } } },
      }),
    );
    await expect(create()).rejects.toHaveProperty('ambiguous', true);
    fetch.mockResolvedValueOnce(
      new Response('', { status: 429, headers: { 'Retry-After': '60' } }),
    );
    await expect(create()).rejects.toMatchObject({ ambiguous: false, retryAfter: 60 });
  });
  it('looks an issue up by ID within the team and reports a missing one as null', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ data: { issues: { nodes: [{ identifier: 'FB-3' }] } } }),
      )
      .mockResolvedValueOnce(Response.json({ data: { issues: { nodes: [] } } }));
    vi.stubGlobal('fetch', fetch);
    const issueId = crypto.randomUUID();
    expect(await linearAdapter(config).reconcile(issueId)).toBe('FB-3');
    expect(body(fetch.mock.calls[0]).variables).toEqual({
      id: issueId,
      teamId: config.linearTeamId,
    });
    expect(await linearAdapter(config).reconcile(issueId)).toBeNull();
  });
  it('derives a stable, unpredictable UUID v4 issue ID per account and submission', () => {
    const linear = linearAdapter(config);
    const id = linear.issueId('user', 'b3a37ad0-6f5a-4ca8-96e1-499b169767df');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(linearAdapter(config).issueId('user', 'b3a37ad0-6f5a-4ca8-96e1-499b169767df')).toBe(id);
    expect(linear.issueId('other-user', 'b3a37ad0-6f5a-4ca8-96e1-499b169767df')).not.toBe(id);
    expect(linear.issueId('user', 'a3a37ad0-6f5a-4ca8-96e1-499b169767df')).not.toBe(id);
    expect(
      linearAdapter({ ...config, secret: 'y'.repeat(32) }).issueId(
        'user',
        'b3a37ad0-6f5a-4ca8-96e1-499b169767df',
      ),
    ).not.toBe(id);
  });
});
