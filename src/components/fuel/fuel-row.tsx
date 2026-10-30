'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown, Settings2, Trash2 } from 'lucide-react';
import type { Repository } from '@/lib/garage/repository';
import type { Car, FuelEntry } from '@/lib/garage/model';
import type { FuelEconomy } from '@/lib/fuel/economy';
import { useDisplay } from '@/i18n/use-display';
import { FuelEntryDetail } from './fuel-entry-detail';
import { TankBadge } from './tank-badge';
import { useFuelDisplay } from './use-fuel-display';

export type FuelEntryProps = {
  entry: FuelEntry;
  car?: Car;
  economy?: FuelEconomy;
  repository: Repository;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

export function FuelRow({
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
    <>
      <tr>
        <td>
          <button
            className="table-expand fuel-date"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={detailId}
          >
            {displayDate(entry.date)}
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        </td>
        <td>
          <strong>{car?.name ?? t('fuel.unknown')}</strong>
          {car?.isArchived && <span className="count-badge">{t('archive.archived')}</span>}
        </td>
        <td>{formatDistance(entry.odometer, car?.distanceUnit)}</td>
        <td>
          {fuel.volume(entry)} <TankBadge entry={entry} />
        </td>
        <td>{t(`fuel.types.${entry.fuelType}`)}</td>
        <td>{fuel.unitPrice(entry)}</td>
        <td>
          <strong>{fuel.total(entry)}</strong>
        </td>
        <td>{economy ? fuel.economy(economy.byEntry.get(entry.id), economy.unit) : '—'}</td>
        <td>
          <div className="row-actions">
            <button className="icon-button" onClick={onEdit} aria-label={t('fuel.editEntry')}>
              <Settings2 size={16} aria-hidden="true" />
            </button>
            <button
              className="icon-button danger"
              onClick={onDelete}
              aria-label={t('fuel.deleteEntry')}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
        </td>
      </tr>
      <tr className="detail-row" id={detailId} hidden={!expanded}>
        <td colSpan={9}>{expanded && <FuelEntryDetail entry={entry} repository={repository} />}</td>
      </tr>
    </>
  );
}
