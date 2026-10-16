import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import './globals.css';
import './localization.css';
import './usability.css';

const productionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;

export const metadata: Metadata = {
  metadataBase: new URL(productionUrl ? `https://${productionUrl}` : 'http://localhost:3000'),
  title: 'Garage Guardian',
  description: 'A clear home for your car maintenance history and upcoming work.',
  robots: { index: false, follow: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
