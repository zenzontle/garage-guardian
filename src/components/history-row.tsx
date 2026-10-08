'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Settings2, Trash2 } from 'lucide-react';
import { type Repository } from '@/lib/repository';
import { type Car, type Visit } from '@/lib/model';
import { useDisplay } from '@/i18n/use-display';
import { HistoryVisitDetail } from './history-visit-detail';

export type HistoryVisitProps = {
  visit: Visit;
  car?: Car;
  repository: Repository;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

export function HistoryRow({
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
    <>
      <tr>
        <td>{displayDate(visit.date)}</td>
        <td>
          <strong>{car?.name ?? t('history.unknown')}</strong>
        </td>
        <td>
          <button
            className="table-expand"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={detailId}
          >
            {visit.items.map((item) => item.name).join(', ') || t('shared.serviceVisit')}
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        </td>
        <td>{formatDistance(visit.odometer, car?.distanceUnit)}</td>
        <td>{visit.provider || '—'}</td>
        <td>
          <strong>{money(visit.totalCostCents)}</strong>
        </td>
        <td>{visit.photos.length ? number(visit.photos.length) : '—'}</td>
        <td>
          <div className="row-actions">
            <button className="icon-button" onClick={onEdit} aria-label={t('history.edit')}>
              <Settings2 size={16} aria-hidden="true" />
            </button>
            <button
              className="icon-button danger"
              onClick={onDelete}
              aria-label={t('history.delete')}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        </td>
      </tr>
      <tr className="detail-row" id={detailId} hidden={!expanded}>
        <td colSpan={8}>
          {expanded && <HistoryVisitDetail visit={visit} repository={repository} />}
        </td>
      </tr>
    </>
  );
}
