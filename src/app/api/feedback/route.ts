import {
  authenticate,
  clientIp,
  errorResponse,
  publicMetadata,
  reportConfig,
  reportingEnabled,
} from '@/lib/feedback/server-config';
import { reportStore } from '@/lib/feedback/store';
import { linearAdapter } from '@/lib/feedback/linear';
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
    const linear = linearAdapter(config);
    const replay = await replayReport(store, linear, userId, input.report, input.hash);
    if (replay) return replay;
    await store.processing(userId, ip);
    return await submitReport(store, linear, userId, ip, await decodeReport(input));
  } catch (cause) {
    return errorResponse(cause);
  }
}
