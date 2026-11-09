import type { NextConfig } from 'next';
import { securityHeaders } from './src/lib/utils/security-headers';

const headers = securityHeaders({
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || undefined,
  development: process.env.NODE_ENV === 'development',
});

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers }];
  },
};

export default nextConfig;
