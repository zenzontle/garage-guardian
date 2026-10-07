'use client';

import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { type DueItem } from '@/lib/due';
import { useDisplay } from '@/i18n/use-display';

export function DueRow({ item, onClick }: { item: DueItem; onClick?: () => void }) {
  const t = useTranslations();
  const { dueDescription } = useDisplay();
  const content = (
    <>
      <span className={`status-dot ${item.status}`} />
      <span className="due-main">
        <strong>{item.schedule.name}</strong>
        <small>
          {item.car.name} · {dueDescription(item)}
        </small>
      </span>
      <span className={`status-pill ${item.status}`}>
        {item.status === 'due'
          ? t('shared.dueNow')
          : item.status === 'upcoming'
            ? t('shared.comingUp')
            : item.status === 'setup'
              ? t('shared.setup')
              : item.status === 'completed'
                ? t('shared.done')
                : t('shared.later')}
      </span>
    </>
  );
  return onClick ? (
    <button className="due-row" onClick={onClick}>
      {content}
      <ArrowRight size={16} />
    </button>
  ) : (
    <div className="due-row">{content}</div>
  );
}
