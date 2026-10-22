'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ClipboardList } from 'lucide-react';
import { isCloudConfigured } from '@/lib/garage/repository';
import {
  normalizePlate,
  defaultReminderDistance,
  distanceUnitOrDefault,
  newId,
  type Car,
  type DistanceUnit,
} from '@/lib/garage/model';
import { EditableCombobox } from '../ui/editable-combobox';
import { useVehicleCatalog } from '@/lib/vehicles/use-vehicle-catalog';
import { normalizeVehicleKey } from '@/lib/vehicles/vehicle-catalog';
import { failureOf, type AppFailure } from '@/lib/utils/app-error';
import { Modal } from '../ui/modal';
import { useFormInteraction } from '../interaction/use-form-interaction';
import { stepDistanceInput } from '../ui/step-distance-input';

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
  const interaction = useFormInteraction(
    { distanceUnit, name, year, make, model, vin, plate, odometer, reminderDays, reminderMiles },
    { busy },
  );
  const close = () => interaction.request(onClose);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const miles = Number(odometer);
    if (!Number.isInteger(miles) || miles < 0) {
      setFormError({ code: 'odometer' });
      return;
    }
    if (!interaction.begin()) return;
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
          isArchived: item?.isArchived ?? false,
          distanceUnit,
          odometer: miles,
          reminderDays: Number(reminderDays),
          reminderMiles: Number(reminderMiles),
          createdAt: item?.createdAt ?? new Date().toISOString(),
        },
        !item,
      );
      interaction.accept();
    } catch (cause) {
      setFormError(failureOf(cause, 'save'));
    } finally {
      interaction.end();
      setBusy(false);
    }
  }
  return (
    <Modal
      title={item ? t('car.edit') : t('shared.addCar')}
      subtitle={t('car.modalSubtitle')}
      onClose={close}
      busy={busy}
    >
      <form onSubmit={submit} aria-busy={busy}>
        <fieldset className="interaction-fields" disabled={busy}>
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
                required
              />
            </label>
            <div className="form-grid">
              <label>
                <span className="field-label">
                  VIN <span className="optional">{t('shared.optional')}</span>
                </span>
                <input
                  value={vin}
                  onChange={(e) => setVin(e.target.value)}
                  maxLength={17}
                  placeholder={t('car.vinExample')}
                />
              </label>
              <label>
                <span className="field-label">
                  {t('car.licensePlate')}
                  <span className="optional">{t('shared.optional')}</span>
                </span>
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
                  onKeyDown={(e) =>
                    stepDistanceInput(e, 500, (value) => {
                      setReminderMiles(value);
                      setReminderCustomized(true);
                    })
                  }
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
            <button type="button" className="button secondary" onClick={close}>
              {t('shared.cancel')}
            </button>
            <button className="button primary" disabled={busy}>
              {busy ? t('shared.saving') : item ? t('shared.saveChanges') : t('car.saveNew')}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
