import {
  authenticate,
  clientIp,
  errorResponse,
  publicMetadata,
  reportConfig,
  reportingEnabled,
} from '@/lib/feedback/server-config';
import { reportStore } from '@/lib/feedback/store';
import { githubAdapter } from '@/lib/feedback/github';
import { decodeReport, readReport, replayReport, submitReport } from '@/lib/feedback/submission';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(request: Request) {
  if (!reportingEnabled())
    return Response.json({ error: 'Feedback is disabled.', code: 'DISABLED' }, { status: 404 });
  try {
    const config = reportConfig();
    const userId = await authenticate(request, config);
    const ip = clientIp(request);
    const store = reportStore(config);
    await store.control(userId);
    const input = await readReport(request, publicMetadata(request, config, userId));
    const github = githubAdapter(config);
    const replay = await replayReport(store, github, userId, input.report, input.hash);
    if (replay) return replay;
    await store.processing(userId, ip);
    return await submitReport(store, github, userId, ip, await decodeReport(input));
  } catch (cause) {
    return errorResponse(cause);
  }
}
