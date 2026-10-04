import { authenticate, clientIp, errorResponse, publicMetadata, reportConfig, reportingEnabled } from '@/lib/bug-reports/server-config';
import { reportStore } from '@/lib/bug-reports/store';
import { githubAdapter } from '@/lib/bug-reports/github';
import { readReport, submitReport } from '@/lib/bug-reports/submission';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!reportingEnabled()) return Response.json({ error: 'Bug reporting is disabled.', code: 'DISABLED' }, { status: 404 });
  try {
    const config = reportConfig();
    const userId = await authenticate(request, config);
    const ip = clientIp(request);
    const store = reportStore(config);
    await store.control(userId);
    const input = await readReport(request, publicMetadata(request, config, userId));
    return await submitReport(store, githubAdapter(config), userId, ip, input);
  } catch (cause) { return errorResponse(cause); }
}
