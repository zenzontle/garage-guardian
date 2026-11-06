// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('feedback smoke destination guard', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('FEEDBACK_SMOKE_URL', 'https://preview.example.test');
    vi.stubEnv('FEEDBACK_SMOKE_ACCESS_TOKEN', 'synthetic-test-token');
    vi.stubEnv('FEEDBACK_SMOKE_BYPASS_TOKEN', undefined);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it.each(['production', 'development'])(
    'refuses the %s reporting environment before submitting',
    async (environment) => {
      const fetchMock = vi
        .fn()
        .mockRejectedValue(new Error('Unexpected submission outside preview'))
        .mockResolvedValueOnce(Response.json({ enabled: true, metadata: { environment } }));
      vi.stubGlobal('fetch', fetchMock);

      await expect(import('./smoke-feedback.mjs')).rejects.toThrow('refuses production');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0].pathname).toBe('/api/feedback/config');
    },
  );

  it('refuses a non-HTTPS deployment before any request', async () => {
    vi.stubEnv('FEEDBACK_SMOKE_URL', 'http://preview.example.test');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(import('./smoke-feedback.mjs')).rejects.toThrow('HTTPS');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails when the receipt does not confirm delivery', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ enabled: true, metadata: { environment: 'preview' } }))
      .mockResolvedValueOnce(Response.json({ state: 'succeeded' }))
      .mockResolvedValueOnce(Response.json({ state: 'unknown' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(import('./smoke-feedback.mjs')).rejects.toThrow('did not confirm delivery');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('fails when the resent draft does not replay the original delivery', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ enabled: true, metadata: { environment: 'preview' } }))
      .mockResolvedValueOnce(Response.json({ state: 'succeeded' }))
      .mockResolvedValueOnce(Response.json({ state: 'succeeded' }))
      .mockResolvedValueOnce(Response.json({ code: 'DRAFT_CHANGED' }, { status: 409 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(import('./smoke-feedback.mjs')).rejects.toThrow('original delivery');
  });

  it.each([undefined, 'synthetic-bypass-token'])(
    'verifies the receipt and a resend of the same draft with bypass token %s',
    async (bypassToken) => {
      vi.stubEnv('FEEDBACK_SMOKE_BYPASS_TOKEN', bypassToken);
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ enabled: true, metadata: { environment: 'preview' } }),
        )
        .mockResolvedValueOnce(Response.json({ state: 'succeeded' }))
        .mockResolvedValueOnce(Response.json({ state: 'succeeded' }))
        .mockResolvedValueOnce(Response.json({ state: 'succeeded' }));
      vi.stubGlobal('fetch', fetchMock);

      await import('./smoke-feedback.mjs');

      expect(fetchMock).toHaveBeenCalledTimes(4);
      for (const [requestUrl, request] of fetchMock.mock.calls) {
        expect(request.headers['x-vercel-protection-bypass']).toBe(bypassToken);
        expect(request.headers.Authorization).toBe('Bearer synthetic-test-token');
        expect(requestUrl.search).toBe('');
      }
      if (bypassToken) expect(console.log.mock.calls.flat().join('\n')).not.toContain(bypassToken);
      expect(console.log.mock.calls.flat().join('\n')).toContain('Feedback test (FBT) team');
      const [submissionUrl, submissionRequest] = fetchMock.mock.calls[1];
      expect(submissionUrl.pathname).toBe('/api/feedback');
      expect(submissionRequest.method).toBe('POST');
      const report = JSON.parse(submissionRequest.body.get('report'));
      expect(fetchMock.mock.calls[2][0].pathname).toBe(`/api/feedback/${report.submissionId}`);
      const [resendUrl, resendRequest] = fetchMock.mock.calls[3];
      expect(resendUrl.pathname).toBe('/api/feedback');
      expect(JSON.parse(resendRequest.body.get('report'))).toEqual(report);
    },
  );
});
