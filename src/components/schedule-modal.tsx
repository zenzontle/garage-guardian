'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { newId, type DistanceUnit, type ScheduleItem } from '@/lib/model';
import { failureOf, type AppFailure } from '@/lib/app-error';
import { Modal } from './modal';

export function ScheduleModal({
  item,
  carId,
  distanceUnit,
  onClose,
  onSave,
}: {
  item?: ScheduleItem;
  carId: string;
  distanceUnit: DistanceUnit;
  onClose: () => void;
  onSave: (item: ScheduleItem) => Promise<void>;
}) {
  const t = useTranslations();
  const [name, setName] = useState(item?.name ?? '');
  const [intervalMiles, setIntervalMiles] = useState(item?.intervalMiles?.toString() ?? '');
  const [intervalMonths, setIntervalMonths] = useState(item?.intervalMonths?.toString() ?? '');
  const [firstDueMiles, setFirstDueMiles] = useState(item?.firstDueMiles?.toString() ?? '');
  const [firstDueDate, setFirstDueDate] = useState(item?.firstDueDate ?? '');
  const [sourceNote, setSourceNote] = useState(item?.sourceNote ?? '');
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<AppFailure | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await onSave({
        id: item?.id ?? newId(),
        carId,
        name: name.trim(),
        intervalMiles: intervalMiles ? Number(intervalMiles) : null,
        intervalMonths: intervalMonths ? Number(intervalMonths) : null,
        firstDueMiles: firstDueMiles ? Number(firstDueMiles) : null,
        firstDueDate: firstDueDate || null,
        sourceNote: sourceNote.trim(),
        isActive,
        createdAt: item?.createdAt ?? new Date().toISOString(),
      });
    } catch (cause) {
      setFormError(failureOf(cause, 'save'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={item ? t('schedule.edit') : t('schedule.add')}
      subtitle={t('schedule.subtitle')}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-stack">
          <label>
            {t('schedule.name')}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder={t('schedule.example')}
              maxLength={80}
            />
          </label>
          <div className="form-grid">
            <label>
              {t('schedule.firstDistance', { unit: t(`units.${distanceUnit}`) })}{' '}
              <span className="optional">{t('shared.optional')}</span>
              <input
                type="number"
                min="0"
                step="1"
                value={firstDueMiles}
                onChange={(e) => setFirstDueMiles(e.target.value)}
                placeholder={t('schedule.distanceExample')}
              />
            </label>
            <label>
              {t('schedule.firstDate')}
              <span className="optional">{t('shared.optional')}</span>
              <input
                type="date"
                value={firstDueDate}
                onChange={(e) => setFirstDueDate(e.target.value)}
              />
            </label>
          </div>
          <div className="form-grid">
            <label>
              {t('schedule.repeatDistance', { unit: t(`units.${distanceUnit}`) })}{' '}
              <span className="optional">{t('shared.optional')}</span>
              <input
                type="number"
                min="1"
                step="1"
                value={intervalMiles}
                onChange={(e) => setIntervalMiles(e.target.value)}
                placeholder={t('schedule.intervalExample')}
              />
            </label>
            <label>
              {t('schedule.repeatMonths')}
              <span className="optional">{t('shared.optional')}</span>
              <input
                type="number"
                min="1"
                step="1"
                value={intervalMonths}
                onChange={(e) => setIntervalMonths(e.target.value)}
                placeholder={t('schedule.monthsExample')}
              />
            </label>
          </div>
          <p className="field-help">{t('schedule.hint')}</p>
          <label>
            {t('schedule.source')}
            <span className="optional">{t('shared.optional')}</span>
            <input
              value={sourceNote}
              onChange={(e) => setSourceNote(e.target.value)}
              placeholder={t('schedule.sourceExample')}
              maxLength={180}
            />
          </label>
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            {t('schedule.active')}
          </label>
          {formError && (
            <p className="error-text" role="alert">
              {t(`errors.${formError.code}`, formError.values)}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            {t('shared.cancel')}
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? t('shared.saving') : t('schedule.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
