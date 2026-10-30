'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDownToLine } from 'lucide-react';
import type { FuelEntry, Photo } from '@/lib/garage/model';
import type { Repository } from '@/lib/garage/repository';
import { failureOf, type AppFailure } from '@/lib/utils/app-error';
import { downloadUrl } from '@/lib/utils/download-url';

export function FuelEntryDetail({
  entry,
  repository,
}: {
  entry: FuelEntry;
  repository: Repository;
}) {
  const t = useTranslations();
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
        <strong>{t('fuel.station')}</strong>
        <p>{entry.station || '—'}</p>
      </div>
      {entry.missedPrevious && (
        <div>
          <strong>{t('fuel.missed')}</strong>
          <p>{t('fuel.missedPreviousHint')}</p>
        </div>
      )}
      {entry.notes && (
        <div>
          <strong>{t('shared.notes')}</strong>
          <p>{entry.notes}</p>
        </div>
      )}
      {entry.photos.length > 0 && (
        <div>
          <strong>{t('shared.photos')}</strong>
          <div className="photo-links">
            {entry.photos.map((photo) => (
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
