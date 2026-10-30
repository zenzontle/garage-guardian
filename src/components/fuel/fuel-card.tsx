'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Settings2, Trash2 } from 'lucide-react';
import { useDisplay } from '@/i18n/use-display';
import { FuelEntryDetail } from './fuel-entry-detail';
import type { FuelEntryProps } from './fuel-row';
import { TankBadge } from './tank-badge';
import { useFuelDisplay } from './use-fuel-display';

export function FuelCard({
  entry,
  car,
  economy,
  repository,
  expanded,
  onToggle,
  onEdit,
  onDelete,
}: FuelEntryProps) {
  const t = useTranslations();
  const { displayDate, formatDistance } = useDisplay();
  const fuel = useFuelDisplay();
  const detailId = useId();
  return (
    <li className="history-card">
      <div className="history-card-heading">
        <div>
          <time dateTime={entry.date}>{displayDate(entry.date)}</time>
          <strong>{car?.name ?? t('fuel.unknown')}</strong>
          {car?.isArchived && <span className="count-badge">{t('archive.archived')}</span>}
        </div>
        <strong>{fuel.total(entry)}</strong>
      </div>
      <button
        className="table-expand"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={detailId}
      >
        {fuel.volume(entry)} · {t(`fuel.types.${entry.fuelType}`)}
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      <dl className="history-card-facts">
        <div>
          <dt>{t('history.odometer')}</dt>
          <dd>{formatDistance(entry.odometer, car?.distanceUnit)}</dd>
        </div>
        <div>
          <dt>{t('fuel.price')}</dt>
          <dd>{fuel.unitPrice(entry)}</dd>
        </div>
        <div>
          <dt>{t('fuel.economy')}</dt>
          <dd>{economy ? fuel.economy(economy.byEntry.get(entry.id), economy.unit) : '—'}</dd>
        </div>
        <div>
          <dt>{t('fuel.details')}</dt>
          <dd>
            <TankBadge entry={entry} />
          </dd>
        </div>
      </dl>
      <div className="row-actions">
        <button className="button secondary" onClick={onEdit}>
          <Settings2 size={16} aria-hidden="true" />
          {t('fuel.editEntry')}
        </button>
        <button className="button secondary danger-text" onClick={onDelete}>
          <Trash2 size={16} aria-hidden="true" />
          {t('fuel.deleteEntry')}
        </button>
      </div>
      <div id={detailId} hidden={!expanded}>
        {expanded && <FuelEntryDetail entry={entry} repository={repository} />}
      </div>
    </li>
  );
}
