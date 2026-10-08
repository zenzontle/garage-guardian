'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { type DueItem } from '@/lib/due';
import { useDisplay } from '@/i18n/use-display';

export function DueRow({ item, href }: { item: DueItem; href?: string }) {
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
  return href ? (
    <Link className="due-row" href={href}>
      {content}
      <ArrowRight size={16} />
    </Link>
  ) : (
    <div className="due-row">{content}</div>
  );
}
