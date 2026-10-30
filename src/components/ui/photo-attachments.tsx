'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { X } from 'lucide-react';
import type { Photo } from '@/lib/garage/model';
import type { Repository } from '@/lib/garage/repository';
import { failureOf, type AppFailure } from '@/lib/utils/app-error';
import { resizePhoto } from '@/lib/utils/resize-photo';

export const PHOTO_LIMIT = 3;

type Progress = { phase: 'photos' | 'saving' | 'cleanup'; completed: number };

// Photos kept from the saved record plus resized new files, uploaded only when the form saves.
export function usePhotoAttachments(
  initial: Photo[],
  onError: (failure: AppFailure | null) => void,
) {
  const input = useRef<HTMLInputElement>(null);
  const preparation = useRef(false);
  const [files, setFiles] = useState<File[]>([]);
  const [retained, setRetained] = useState<Photo[]>(initial);
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);

  async function add(list: FileList | null, busy: boolean) {
    if (!list || preparation.current || busy) return;
    onError(null);
    const incoming = Array.from(list);
    if (files.length + retained.length + incoming.length > PHOTO_LIMIT) {
      onError({ code: 'photoLimit' });
      return;
    }
    if (!incoming.length) return;
    preparation.current = true;
    setPreparing(true);
    try {
      const processed = await Promise.all(incoming.map(resizePhoto));
      setFiles((current) => [...current, ...processed]);
    } catch (cause) {
      onError(failureOf(cause, 'photoPrepare'));
    } finally {
      preparation.current = false;
      setPreparing(false);
      if (input.current) input.current.value = '';
    }
  }

  // Uploads into `uploaded` as it goes, so a failed save can clean up partial uploads.
  async function upload(repository: Repository, recordId: string, uploaded: Photo[]) {
    setProgress({ phase: files.length ? 'photos' : 'saving', completed: 0 });
    for (const file of files) {
      uploaded.push(await repository.uploadPhoto(recordId, file));
      setProgress({ phase: 'photos', completed: uploaded.length });
    }
    setProgress({ phase: 'saving', completed: files.length });
    return [...retained, ...uploaded];
  }

  async function cleanup(repository: Repository, uploaded: Photo[]) {
    setProgress({ phase: 'cleanup', completed: uploaded.length });
    for (const photo of uploaded) await repository.removePhoto(photo).catch(() => undefined);
  }

  return {
    input,
    files,
    setFiles,
    retained,
    setRetained,
    preparing,
    preparation,
    progress,
    add,
    upload,
    cleanup,
    finish: () => setProgress(null),
    // Unsaved-change tracking compares these, not the File objects themselves.
    state: {
      files: files.map((file) => ({
        name: file.name,
        size: file.size,
        modified: file.lastModified,
      })),
      photos: retained.map((photo) => photo.id),
    },
  };
}

export function PhotoPicker({
  attachments,
  busy,
  cloud,
  savingLabel,
}: {
  attachments: ReturnType<typeof usePhotoAttachments>;
  busy: boolean;
  cloud: boolean;
  savingLabel: string;
}) {
  const t = useTranslations();
  const { input, files, setFiles, retained, setRetained, preparing, progress } = attachments;
  return (
    <>
      <div className="photo-picker">
        <label>
          <span className="field-label">
            {t('shared.photos')} <span className="optional">{t('visit.photoLimit')}</span>
          </span>
          <input
            ref={input}
            className="sr-only"
            tabIndex={-1}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => void attachments.add(e.target.files, busy)}
          />
        </label>
        <button type="button" className="button secondary" onClick={() => input.current?.click()}>
          {t('visit.choosePhotos')}
        </button>
        {retained.map((photo) => (
          <span className="file-chip" key={photo.id}>
            {photo.name}
            <button
              type="button"
              aria-label={t('shared.removeNamed', { name: photo.name })}
              onClick={() =>
                setRetained((current) => current.filter((entry) => entry.id !== photo.id))
              }
            >
              <X size={13} />
            </button>
          </span>
        ))}
        {files.map((file, index) => (
          <span className="file-chip" key={`${file.name}-${index}`}>
            {file.name}
            <button
              type="button"
              aria-label={t('shared.removeNamed', { name: file.name })}
              onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
            >
              <X size={13} />
            </button>
          </span>
        ))}
      </div>
      {(preparing || progress) && (
        <div className="upload-status" role="status" aria-live="polite">
          <p>
            {preparing
              ? t('interactions.preparingPhotos')
              : progress?.phase === 'photos'
                ? t(cloud ? 'interactions.uploadingPhoto' : 'interactions.savingPhoto', {
                    current: Math.min((progress?.completed ?? 0) + 1, files.length),
                    total: files.length,
                  })
                : progress?.phase === 'cleanup'
                  ? t('interactions.cleaningPhotos')
                  : savingLabel}
          </p>
          {progress?.phase === 'photos' && (
            <progress
              aria-label={t('interactions.photoProgress')}
              max={files.length}
              value={progress.completed}
            />
          )}
        </div>
      )}
    </>
  );
}
