'use client';

import { useTranslations } from 'next-intl';
import Image from 'next/image';
export type Screenshot = { file: File; url: string };

export function BugReportScreenshots({
  screenshots,
  sent,
  busy,
  onRemove,
}: {
  screenshots: Screenshot[];
  sent: boolean;
  busy: boolean;
  onRemove: (index: number) => void;
}) {
  const t = useTranslations('bugReports');
  return (
    <div className="bug-report-screenshots">
      {screenshots.map((item, index) => (
        <figure key={item.url}>
          <Image
            src={item.url}
            alt={t('screenshotAlt', { count: index + 1 })}
            width={640}
            height={220}
            style={{ height: 'auto' }}
            unoptimized
          />
          <figcaption>
            {t('screenshotCaption', { count: index + 1 })}
            {!sent && (
              <button className="text-link" disabled={busy} onClick={() => onRemove(index)}>
                {t('removeScreenshot', { count: index + 1 })}
              </button>
            )}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
