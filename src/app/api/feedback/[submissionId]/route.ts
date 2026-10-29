import { z } from 'zod';
import {
  authenticate,
  errorResponse,
  publicMetadata,
  ReportError,
  reportConfig,
  reportingEnabled,
} from '@/lib/feedback/server-config';
import { reportStore } from '@/lib/feedback/store';
import { githubAdapter } from '@/lib/feedback/github';
import { receiptResponse, reconcileReceipt } from '@/lib/feedback/submission';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(
  request: Request,
  context: { params: Promise<{ submissionId: string }> },
) {
  if (!reportingEnabled())
    return Response.json({ error: 'Feedback is disabled.', code: 'DISABLED' }, { status: 404 });
  try {
    const id = z.uuid().safeParse((await context.params).submissionId);
    if (!id.success) throw new ReportError(422, 'INVALID_REPORT', 'Invalid submission reference.');
    const config = reportConfig();
    const userId = await authenticate(request, config);
    const store = reportStore(config);
    await store.control(userId);
    const receipt = await store.get(userId, id.data);
    if (!receipt) throw new ReportError(404, 'NOT_FOUND', 'No submission was found.');
    return receiptResponse(
      await reconcileReceipt(
        store,
        githubAdapter(config),
        userId,
        id.data,
        receipt,
        publicMetadata(request, config, userId).reporterId,
      ),
    );
  } catch (cause) {
    return errorResponse(cause);
  }
}
