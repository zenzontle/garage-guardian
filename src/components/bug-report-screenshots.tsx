'use client';

import { useTranslations } from 'next-intl';
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
          <img src={item.url} alt={t('screenshotAlt', { count: index + 1 })} />
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
