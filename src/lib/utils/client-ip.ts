import { isIP } from 'node:net';

// Vercel sets x-vercel-forwarded-for itself; other forwarding headers are client-selected.
// Only call this on a Vercel deployment.
export function vercelClientIp(request: Request): string | null {
  let ip = (request.headers.get('x-vercel-forwarded-for') || '').trim().toLowerCase();
  if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  const kind = isIP(ip);
  if (!kind) return null;
  return kind === 6 ? new URL(`http://[${ip}]/`).hostname.slice(1, -1) : ip;
}
