'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';
import { latestOdometer } from '@/lib/maintenance/due';
import { type Repository } from '@/lib/garage/repository';
import {
  distanceUnitOrDefault,
  newId,
  type Car,
  type ScheduleItem,
  type Visit,
  type VisitItem,
  type Photo,
} from '@/lib/garage/model';
import { MoneyInput } from '../ui/money-input';
import { failureOf, type AppFailure } from '@/lib/utils/app-error';
import { Modal } from '../ui/modal';
import { useFormInteraction } from '../interaction/use-form-interaction';
import { todayISO } from '@/lib/utils/today-iso';
import { resizePhoto } from '@/lib/utils/resize-photo';

type EditVisitItem = VisitItem & { key: string; costInput: string };

export function VisitModal({
  item,
  carId,
  cars,
  visits,
  schedules,
  repository,
  onClose,
  onSave,
  cloud = false,
}: {
  item?: Visit;
  cloud?: boolean;
  carId?: string;
  cars: Car[];
  visits: Visit[];
  schedules: ScheduleItem[];
  repository: Repository;
  onClose: () => void;
  onSave: (visit: Visit) => Promise<void>;
}) {
  const t = useTranslations();
  const photoInput = useRef<HTMLInputElement>(null);
  const initialCar = cars.find((car) => car.id === (item?.carId ?? carId ?? cars[0]?.id));
  const [selectedCarId, setSelectedCarId] = useState(item?.carId ?? carId ?? cars[0]?.id ?? '');
  const [date, setDate] = useState(item?.date ?? todayISO());
  const [odometer, setOdometer] = useState(
    item
      ? String(item.odometer ?? '')
      : String(initialCar ? latestOdometer(initialCar, visits) : ''),
  );
  const [totalCost, setTotalCost] = useState(item ? (item.totalCostCents / 100).toFixed(2) : '');
  const [provider, setProvider] = useState(item?.provider ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [items, setItems] = useState<EditVisitItem[]>(
    item?.items.map((entry) => ({
      ...entry,
      key: entry.id,
      costInput: entry.costCents === null ? '' : (entry.costCents / 100).toFixed(2),
    })) ?? [
      { id: newId(), key: newId(), name: '', scheduleItemId: null, costCents: null, costInput: '' },
    ],
  );
  const [files, setFiles] = useState<File[]>([]);
  const [retainedPhotos, setRetainedPhotos] = useState<Photo[]>(item?.photos ?? []);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<AppFailure | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState<{
    phase: 'photos' | 'saving' | 'cleanup';
    completed: number;
  } | null>(null);
  const preparation = useRef(false);
  const interaction = useFormInteraction(
    {
      selectedCarId,
      date,
      odometer,
      totalCost,
      provider,
      notes,
      items: items.map(({ name, scheduleItemId, costInput }) => ({
        name,
        scheduleItemId,
        costInput,
      })),
      files: files.map((file) => ({
        name: file.name,
        size: file.size,
        modified: file.lastModified,
      })),
      photos: retainedPhotos.map((photo) => photo.id),
    },
    { busy: busy || preparing },
  );
  const close = () => interaction.request(onClose);
  const distanceUnit = distanceUnitOrDefault(
    cars.find((car) => car.id === selectedCarId)?.distanceUnit,
  );
  const scheduledServiceNames = new Set([
    t('starter.service'),
    'Scheduled service',
    'Servicio programado',
  ]);
  const carSchedules = schedules
    .filter((schedule) => schedule.carId === selectedCarId && schedule.isActive)
    .sort(
      (a, b) =>
        Number(scheduledServiceNames.has(b.name)) - Number(scheduledServiceNames.has(a.name)),
    );
  function updateEntry(key: string, update: Partial<EditVisitItem>) {
    setItems((current) =>
      current.map((entry) => (entry.key === key ? { ...entry, ...update } : entry)),
    );
  }
  function pickSchedule(key: string, id: string) {
    const schedule = carSchedules.find((entry) => entry.id === id);
    updateEntry(key, { scheduleItemId: id || null, name: schedule?.name ?? '' });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const miles = odometer.trim() === '' ? null : Number(odometer),
      cents = Math.round(Number(totalCost || '0') * 100);
    if (
      !selectedCarId ||
      (miles !== null && (!Number.isInteger(miles) || miles < 0)) ||
      !Number.isInteger(cents) ||
      cents < 0
    ) {
      setFormError({ code: 'visitFields' });
      return;
    }
    const cleanItems = items
      .filter((entry) => entry.name.trim())
      .map(({ id, name, scheduleItemId, costCents }): VisitItem => ({
        id,
        name: name.trim(),
        scheduleItemId,
        costCents,
      }));
    if (!cleanItems.length) {
      setFormError({ code: 'serviceItem' });
      return;
    }
    if (cleanItems.reduce((sum, entry) => sum + (entry.costCents ?? 0), 0) > cents) {
      setFormError({ code: 'itemCosts' });
      return;
    }
    if (preparation.current || !interaction.begin()) return;
    setBusy(true);
    setProgress({ phase: files.length ? 'photos' : 'saving', completed: 0 });
    const uploaded: Photo[] = [];
    try {
      const visitId = item?.id ?? newId();
      for (const file of files) {
        uploaded.push(await repository.uploadPhoto(visitId, file));
        setProgress({ phase: 'photos', completed: uploaded.length });
      }
      setProgress({ phase: 'saving', completed: files.length });
      await onSave({
        id: visitId,
        carId: selectedCarId,
        date,
        odometer: miles,
        totalCostCents: cents,
        provider: provider.trim(),
        notes: notes.trim(),
        items: cleanItems,
        photos: [...retainedPhotos, ...uploaded],
        createdAt: item?.createdAt ?? new Date().toISOString(),
      });
      interaction.accept();
    } catch (cause) {
      setProgress({ phase: 'cleanup', completed: uploaded.length });
      for (const photo of uploaded) await repository.removePhoto(photo).catch(() => undefined);
      setFormError(failureOf(cause, 'save'));
    } finally {
      interaction.end();
      setBusy(false);
      setProgress(null);
    }
  }
  async function addFiles(list: FileList | null) {
    if (!list || preparation.current || busy) return;
    setFormError(null);
    const incoming = Array.from(list);
    if (files.length + retainedPhotos.length + incoming.length > 3) {
      setFormError({ code: 'photoLimit' });
      return;
    }
    if (!incoming.length) return;
    preparation.current = true;
    setPreparing(true);
    try {
      const processed = await Promise.all(incoming.map(resizePhoto));
      setFiles((current) => [...current, ...processed]);
    } catch (cause) {
      setFormError(failureOf(cause, 'photoPrepare'));
    } finally {
      preparation.current = false;
      setPreparing(false);
      if (photoInput.current) photoInput.current.value = '';
    }
  }
  return (
    <Modal
      title={item ? t('visit.edit') : t('shared.logService')}
      subtitle={t('visit.subtitle')}
      onClose={close}
      busy={busy || preparing}
    >
      <form onSubmit={submit} aria-busy={busy || preparing}>
        <fieldset className="interaction-fields" disabled={busy || preparing}>
          <div className="modal-body form-stack">
            <div className="form-grid">
              <label>
                {t('shared.vehicle')}
                <select
                  value={selectedCarId}
                  onChange={(e) => {
                    setSelectedCarId(e.target.value);
                    const car = cars.find((car) => car.id === e.target.value);
                    setOdometer(car ? String(latestOdometer(car, visits)) : '');
                    setItems([
                      {
                        id: newId(),
                        key: newId(),
                        name: '',
                        scheduleItemId: null,
                        costCents: null,
                        costInput: '',
                      },
                    ]);
                  }}
                  required
                  disabled={Boolean(item)}
                >
                  {cars.map((car) => (
                    <option key={car.id} value={car.id}>
                      {car.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('shared.date')}
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  max={todayISO()}
                  required
                />
              </label>
            </div>
            <div className="form-grid">
              <label>
                {t('visit.odometerInput', { unit: t(`units.${distanceUnit}`) })}
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={odometer}
                  onChange={(e) => setOdometer(e.target.value)}
                />
              </label>
              <label>
                {t('visit.total')}
                <MoneyInput
                  label={t('visit.total')}
                  value={totalCost}
                  onChange={setTotalCost}
                  placeholder="0.00"
                />
              </label>
            </div>
            <label>
              <span className="field-label">
                {t('shared.provider')} <span className="optional">{t('shared.optional')}</span>
              </span>
              <input
                value={provider}
                onChange={(e) => setProvider(e.target.value)}
                placeholder={t('visit.providerExample')}
                maxLength={100}
              />
            </label>
            <div className="items-editor">
              <div className="items-header">
                <strong>{t('visit.completedItems')}</strong>
                <button
                  type="button"
                  className="text-link"
                  onClick={() =>
                    setItems((current) => [
                      ...current,
                      {
                        id: newId(),
                        key: newId(),
                        name: '',
                        scheduleItemId: null,
                        costCents: null,
                        costInput: '',
                      },
                    ])
                  }
                >
                  <Plus size={16} />
                  {t('visit.addItem')}
                </button>
              </div>
              {items.map((entry) => (
                <div className="item-editor-row" key={entry.key}>
                  <select
                    aria-label={t('visit.chooseTask')}
                    value={entry.scheduleItemId ?? ''}
                    onChange={(e) => pickSchedule(entry.key, e.target.value)}
                  >
                    <option value="">{t('visit.custom')}</option>
                    {carSchedules.map((schedule) => (
                      <option key={schedule.id} value={schedule.id}>
                        {schedule.name}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label={t('visit.itemName')}
                    value={entry.name}
                    onChange={(e) =>
                      updateEntry(entry.key, { name: e.target.value, scheduleItemId: null })
                    }
                    placeholder={t('visit.itemPlaceholder')}
                    maxLength={80}
                  />
                  <MoneyInput
                    label={t('visit.itemCost')}
                    value={entry.costInput}
                    onChange={(value) =>
                      updateEntry(entry.key, {
                        costInput: value,
                        costCents: value === '' ? null : Math.round(Number(value) * 100),
                      })
                    }
                    placeholder={t('visit.costPlaceholder')}
                  />
                  <button
                    type="button"
                    className="icon-button danger"
                    aria-label={t('visit.removeItem')}
                    disabled={items.length === 1}
                    onClick={() =>
                      setItems((current) => current.filter((value) => value.key !== entry.key))
                    }
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
            <label>
              <span className="field-label">
                {t('shared.notes')} <span className="optional">{t('shared.optional')}</span>
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder={t('visit.notesExample')}
                maxLength={2000}
              />
            </label>
            <div className="photo-picker">
              <label>
                <span className="field-label">
                  {t('shared.photos')} <span className="optional">{t('visit.photoLimit')}</span>
                </span>
                <input
                  ref={photoInput}
                  className="sr-only"
                  tabIndex={-1}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => void addFiles(e.target.files)}
                />
              </label>
              <button
                type="button"
                className="button secondary"
                onClick={() => photoInput.current?.click()}
              >
                {t('visit.choosePhotos')}
              </button>
              {retainedPhotos.map((photo) => (
                <span className="file-chip" key={photo.id}>
                  {photo.name}
                  <button
                    type="button"
                    aria-label={t('shared.removeNamed', { name: photo.name })}
                    onClick={() =>
                      setRetainedPhotos((current) =>
                        current.filter((entry) => entry.id !== photo.id),
                      )
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
                      : t(
                          progress?.phase === 'cleanup'
                            ? 'interactions.cleaningPhotos'
                            : 'interactions.savingVisit',
                        )}
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
            {formError && (
              <p className="error-text" role="alert">
                {t(`errors.${formError.code}`, formError.values)}
              </p>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="button secondary" onClick={close}>
              {t('shared.cancel')}
            </button>
            <button className="button primary" disabled={busy}>
              {busy ? t('shared.saving') : item ? t('shared.saveChanges') : t('visit.save')}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
