'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDownToLine } from 'lucide-react';
import type { Visit, Photo } from '@/lib/garage/model';
import type { Repository } from '@/lib/garage/repository';
import { useDisplay } from '@/i18n/use-display';
import { failureOf, type AppFailure } from '@/lib/utils/app-error';
import { downloadUrl } from '@/lib/utils/download-url';

export function HistoryVisitDetail({
  visit,
  repository,
}: {
  visit: Visit;
  repository: Repository;
}) {
  const t = useTranslations();
  const { money } = useDisplay();
  const [photoError, setPhotoError] = useState<AppFailure | null>(null);
  async function downloadPhoto(photo: Photo) {
    try {
      setPhotoError(null);
      downloadUrl(await repository.photoUrl(photo), photo.name);
    } catch (cause) {
      setPhotoError(failureOf(cause, 'photo'));
    }
  }
  return (
    <div className="visit-detail">
      <div>
        <strong>{t('history.itemsCompleted')}</strong>
        <p>
          {visit.items
            .map(
              (item) =>
                `${item.name}${item.costCents !== null ? ` (${money(item.costCents, visit.currency ?? 'USD')})` : ''}`,
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
                <ArrowDownToLine size={15} aria-hidden="true" />
                {photo.name}
              </button>
            ))}
          </div>
          {photoError && (
            <p className="error-text" role="alert">
              {t(`errors.${photoError.code}`, photoError.values)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
