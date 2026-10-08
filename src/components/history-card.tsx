'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Settings2, Trash2 } from 'lucide-react';
import { useDisplay } from '@/i18n/use-display';
import type { HistoryVisitProps } from './history-row';
import { HistoryVisitDetail } from './history-visit-detail';

export function HistoryCard({
  visit,
  car,
  repository,
  expanded,
  onToggle,
  onEdit,
  onDelete,
}: HistoryVisitProps) {
  const t = useTranslations();
  const { number, money, displayDate, formatDistance } = useDisplay();
  const detailId = useId();
  return (
    <li className="history-card">
      <div className="history-card-heading">
        <div>
          <time dateTime={visit.date}>{displayDate(visit.date)}</time>
          <strong>{car?.name ?? t('history.unknown')}</strong>
        </div>
        <strong>{money(visit.totalCostCents)}</strong>
      </div>
      <button
        className="table-expand"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={detailId}
      >
        {visit.items.map((item) => item.name).join(', ') || t('shared.serviceVisit')}
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      <dl className="history-card-facts">
        <div>
          <dt>{t('history.odometer')}</dt>
          <dd>{formatDistance(visit.odometer, car?.distanceUnit)}</dd>
        </div>
        <div>
          <dt>{t('shared.provider')}</dt>
          <dd>{visit.provider || '—'}</dd>
        </div>
        <div>
          <dt>{t('shared.photos')}</dt>
          <dd>{number(visit.photos.length)}</dd>
        </div>
      </dl>
      <div className="row-actions">
        <button className="button secondary" onClick={onEdit}>
          <Settings2 size={16} aria-hidden="true" />
          {t('history.edit')}
        </button>
        <button className="button secondary danger-text" onClick={onDelete}>
          <Trash2 size={16} aria-hidden="true" />
          {t('history.delete')}
        </button>
      </div>
      <div id={detailId} hidden={!expanded}>
        {expanded && <HistoryVisitDetail visit={visit} repository={repository} />}
      </div>
    </li>
  );
}
