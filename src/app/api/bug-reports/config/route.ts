import { authenticate, errorResponse, publicMetadata, reportConfig, reportingEnabled } from '@/lib/bug-reports/server-config';
import { reportStore } from '@/lib/bug-reports/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!reportingEnabled()) return Response.json({ enabled: false }, { headers: { 'Cache-Control': 'no-store' } });
  try {
    const config = reportConfig();
    const userId = await authenticate(request, config);
    await reportStore(config).control(userId);
    return Response.json({ enabled: true, metadata: publicMetadata(request, config, userId) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) { return errorResponse(cause); }
}
