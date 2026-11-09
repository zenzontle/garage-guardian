// Browser hardening applied to every route (see next.config.ts).
// Next's inline bootstrap scripts need 'unsafe-inline' unless every page renders dynamically
// with a per-request nonce; the policy still blocks foreign scripts, plugins, framing, and
// sending data (including the Supabase session in localStorage) to unlisted hosts.
export function contentSecurityPolicy({
  supabaseUrl,
  development,
}: {
  supabaseUrl?: string;
  development: boolean;
}) {
  let supabase: string[] = [];
  if (supabaseUrl) {
    const url = new URL(supabaseUrl);
    if (url.protocol !== 'https:' && !development)
      throw new Error('NEXT_PUBLIC_SUPABASE_URL must use HTTPS');
    supabase = [url.origin];
  }
  // Development adds React Refresh's eval and Vercel's debug scripts.
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      "'unsafe-inline'",
      ...(development ? ["'unsafe-eval'", 'https://va.vercel-scripts.com'] : []),
    ],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", ...supabase, ...(development ? ['ws:'] : [])],
    'object-src': ["'none'"],
    'frame-src': ["'none'"],
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ');
}

export function securityHeaders(options: { supabaseUrl?: string; development: boolean }) {
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(options) },
    // Legacy browsers that ignore frame-ancestors.
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    },
    // Browsers ignore this over plain HTTP, so local servers are unaffected.
    { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
  ];
}
