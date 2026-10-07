'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDownToLine, ChevronDown, Settings2, Trash2 } from 'lucide-react';
import { type Repository } from '@/lib/repository';
import { type Car, type Visit, type Photo } from '@/lib/model';
import { useDisplay } from '@/i18n/use-display';
import { failureOf, type AppFailure } from '@/lib/app-error';

export function HistoryRow({
  visit,
  car,
  repository,
  onEdit,
  onDelete,
}: {
  visit: Visit;
  car?: Car;
  repository: Repository;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations();
  const { number, money, displayDate, formatDistance } = useDisplay();
  const [expanded, setExpanded] = useState(false);
  const [photoError, setPhotoError] = useState<AppFailure | null>(null);
  async function downloadPhoto(photo: Photo) {
    try {
      setPhotoError(null);
      const url = await repository.photoUrl(photo);
      const link = document.createElement('a');
      link.href = url;
      link.download = photo.name;
      link.target = '_blank';
      link.click();
      if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (cause) {
      setPhotoError(failureOf(cause, 'photo'));
    }
  }
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
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            {visit.items.map((item) => item.name).join(', ') || t('shared.serviceVisit')}
            <ChevronDown size={15} />
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
              <Settings2 size={16} />
            </button>
            <button
              className="icon-button danger"
              onClick={onDelete}
              aria-label={t('history.delete')}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="detail-row">
          <td colSpan={8}>
            <div className="visit-detail">
              <div>
                <strong>{t('history.itemsCompleted')}</strong>
                <p>
                  {visit.items
                    .map(
                      (item) =>
                        `${item.name}${item.costCents !== null ? ` (${money(item.costCents)})` : ''}`,
                    )
                    .join(' · ') || t('history.noneRecorded')}
                </p>
              </div>
              {visit.notes && (
                <div>
                  <strong>{t('shared.notes')}</strong>
                  <p>{visit.notes}</p>
                </div>
              )}
              {visit.photos.length > 0 && (
                <div>
                  <strong>{t('shared.photos')}</strong>
                  <div className="photo-links">
                    {visit.photos.map((photo) => (
                      <button
                        key={photo.id}
                        className="text-link"
                        onClick={() => void downloadPhoto(photo)}
                      >
                        <ArrowDownToLine size={15} />
                        {photo.name}
                      </button>
                    ))}
                  </div>
                  {photoError && (
                    <p className="error-text">
                      {t(`errors.${photoError.code}`, photoError.values)}
                    </p>
                  )}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
