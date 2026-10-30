'use client';

import { useTranslations } from 'next-intl';
import type { FuelEntry } from '@/lib/garage/model';

export function TankBadge({ entry }: { entry: FuelEntry }) {
  const t = useTranslations();
  return (
    <>
      <span className={`status-pill ${entry.isFullTank ? 'completed' : 'later'}`}>
        {t(entry.isFullTank ? 'fuel.full' : 'fuel.partial')}
      </span>
      {entry.missedPrevious && <span className="count-badge">{t('fuel.missed')}</span>}
    </>
  );
}
