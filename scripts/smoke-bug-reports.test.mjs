// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('bug report smoke destination guard', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('BUG_REPORT_SMOKE_URL', 'https://preview.example.test');
    vi.stubEnv('BUG_REPORT_SMOKE_ACCESS_TOKEN', 'synthetic-test-token');
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it.each([
    'zenzontle/garage-guardian',
    'ZenZontle/Garage-Guardian',
    'ZENZONTLE/GARAGE-GUARDIAN',
  ])('refuses the real tracker %s before submitting', async (repository) => {
    const fetchMock = vi.fn()
      .mockRejectedValue(new Error('Unexpected submission to protected tracker'))
      .mockResolvedValueOnce(Response.json({
        enabled: true, metadata: { environment: 'preview', repository },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(import('./smoke-bug-reports.mjs')).rejects.toThrow('separate TEST repository');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0].pathname).toBe('/api/bug-reports/config');
  });

  it('allows a separate test repository and verifies its receipt', async () => {
    const issueUrl = 'https://github.com/zenzontle/bug-report-test/issues/1';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        enabled: true,
        metadata: { environment: 'preview', repository: 'ZenZontle/Bug-Report-Test' },
      }))
      .mockResolvedValueOnce(Response.json({ state: 'succeeded', issueUrl }))
      .mockResolvedValueOnce(Response.json({ issueUrl }));
    vi.stubGlobal('fetch', fetchMock);

    await import('./smoke-bug-reports.mjs');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [submissionUrl, submissionRequest] = fetchMock.mock.calls[1];
    expect(submissionUrl.pathname).toBe('/api/bug-reports');
    expect(submissionRequest.method).toBe('POST');
    const report = JSON.parse(submissionRequest.body.get('report'));
    expect(fetchMock.mock.calls[2][0].pathname).toBe(`/api/bug-reports/${report.submissionId}`);
  });
});
