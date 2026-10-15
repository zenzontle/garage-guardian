import type { Metadata } from 'next';
import { DashboardScreen } from '@/components/dashboard-screen';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
  robots: {
    index: process.env.VERCEL_ENV === 'production' && !!process.env.VERCEL_PROJECT_PRODUCTION_URL,
    follow: true,
  },
};

export default function Page() {
  return <DashboardScreen />;
}
