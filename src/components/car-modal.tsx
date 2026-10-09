'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ClipboardList } from 'lucide-react';
import { isCloudConfigured } from '@/lib/repository';
import {
  normalizePlate,
  defaultReminderDistance,
  distanceUnitOrDefault,
  newId,
  type Car,
  type DistanceUnit,
} from '@/lib/model';
import { EditableCombobox } from './editable-combobox';
import { useVehicleCatalog } from '@/lib/use-vehicle-catalog';
import { normalizeVehicleKey } from '@/lib/vehicle-catalog';
import { failureOf, type AppFailure } from '@/lib/app-error';
import { Modal } from './modal';

export function CarModal({
  item,
  onClose,
  onSave,
}: {
  item?: Car;
  onClose: () => void;
  onSave: (item: Car, starter: boolean) => Promise<void>;
}) {
  const t = useTranslations();
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>(
    distanceUnitOrDefault(item?.distanceUnit),
  );
  const [reminderCustomized, setReminderCustomized] = useState(false);
  function changeDistanceUnit(unit: DistanceUnit) {
    setDistanceUnit(unit);
    if (!reminderCustomized) setReminderMiles(String(defaultReminderDistance(unit)));
  }
  const [name, setName] = useState(item?.name ?? '');
  const [year, setYear] = useState(String(item?.year ?? new Date().getFullYear()));
  const [make, setMake] = useState(item?.make ?? '');
  const [model, setModel] = useState(item?.model ?? '');
  const [vin, setVin] = useState(item?.vin ?? '');
  const [plate, setPlate] = useState(item?.plate ?? '');
  const [odometer, setOdometer] = useState(String(item?.odometer ?? ''));
  const [reminderDays, setReminderDays] = useState(String(item?.reminderDays ?? 30));
  const [reminderMiles, setReminderMiles] = useState(
    String(item?.reminderMiles ?? defaultReminderDistance(distanceUnit)),
  );
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<AppFailure | null>(null);
  const catalog = useVehicleCatalog(isCloudConfigured, make);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const miles = Number(odometer);
    if (!Number.isInteger(miles) || miles < 0) {
      setFormError({ code: 'odometer' });
      return;
    }
    setBusy(true);
    try {
      await onSave(
        {
          id: item?.id ?? newId(),
          name: name.trim(),
          year: Number(year),
          make: make.trim(),
          model: model.trim(),
          vin: vin.trim().toUpperCase(),
          plate: normalizePlate(plate),
          distanceUnit,
          odometer: miles,
          reminderDays: Number(reminderDays),
          reminderMiles: Number(reminderMiles),
          createdAt: item?.createdAt ?? new Date().toISOString(),
        },
        !item,
      );
    } catch (cause) {
      setFormError(failureOf(cause, 'save'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={item ? t('car.edit') : t('shared.addCar')}
      subtitle={t('car.modalSubtitle')}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="modal-body form-stack">
          <label>
            {t('car.nickname')}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('car.nicknameExample')}
              required
              maxLength={60}
            />
          </label>
          <div className="form-grid three">
            <label>
              {t('car.year')}
              <input
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                min="1980"
                max={new Date().getFullYear() + 1}
                required
              />
            </label>
            {isCloudConfigured ? (
              <EditableCombobox
                label={t('car.make')}
                value={make}
                onChange={setMake}
                placeholder="Toyota"
                suggestions={catalog.makes.entries}
                loading={catalog.makes.loading}
                failed={catalog.makes.failed}
                onRetry={catalog.retry}
              />
            ) : (
              <label>
                {t('car.make')}
                <input
                  value={make}
                  onChange={(e) => setMake(e.target.value)}
                  placeholder="Toyota"
                  required
                  maxLength={50}
                />
              </label>
            )}
            {isCloudConfigured ? (
              <EditableCombobox
                key={normalizeVehicleKey(make)}
                label={t('car.model')}
                value={model}
                onChange={setModel}
                placeholder="RAV4"
                suggestions={catalog.models.entries}
                loading={catalog.models.loading}
                failed={catalog.models.failed}
                onRetry={catalog.retry}
              />
            ) : (
              <label>
                {t('car.model')}
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="RAV4"
                  required
                  maxLength={50}
                />
              </label>
            )}
          </div>
          <label>
            {t('car.distanceUnit')}
            {item ? (
              <input
                value={distanceUnit === 'kilometers' ? t('shared.kilometers') : t('shared.miles')}
                readOnly
              />
            ) : (
              <select
                value={distanceUnit}
                onChange={(e) => changeDistanceUnit(e.target.value as DistanceUnit)}
              >
                <option value="miles">{t('shared.miles')}</option>
                <option value="kilometers">{t('shared.kilometers')}</option>
              </select>
            )}
          </label>
          <label>
            {t('car.odometerInput', { unit: t(`units.${distanceUnit}`) })}
            <input
              type="number"
              value={odometer}
              onChange={(e) => setOdometer(e.target.value)}
              min="0"
              step="1"
              placeholder="48250"
              required
            />
          </label>
          <div className="form-grid">
            <label>
              VIN <span className="optional">{t('shared.optional')}</span>
              <input
                value={vin}
                onChange={(e) => setVin(e.target.value)}
                maxLength={17}
                placeholder={t('car.vinExample')}
              />
            </label>
            <label>
              {t('car.licensePlate')}
              <span className="optional">{t('shared.optional')}</span>
              <input
                value={plate}
                onChange={(e) => setPlate(e.target.value)}
                placeholder={t('car.plateExample')}
              />
            </label>
          </div>
          <div className="form-grid">
            <label>
              {t('car.reminderDays')}
              <input
                type="number"
                min="0"
                max="365"
                step="1"
                value={reminderDays}
                onChange={(e) => setReminderDays(e.target.value)}
                required
              />
            </label>
            <label>
              {t('car.reminderDistance', { unit: t(`units.${distanceUnit}`) })}
              <input
                type="number"
                min="0"
                max="10000"
                step="1"
                value={reminderMiles}
                onChange={(e) => {
                  setReminderMiles(e.target.value);
                  setReminderCustomized(true);
                }}
                required
              />
            </label>
          </div>
          {!item && (
            <div className="info-callout">
              <ClipboardList size={18} />
              <span>{t('car.starterHint')}</span>
            </div>
          )}
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
            {busy ? t('shared.saving') : item ? t('shared.saveChanges') : t('car.saveNew')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
