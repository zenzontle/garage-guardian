'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { latestOdometer } from '@/lib/maintenance/due';
import { type Repository } from '@/lib/garage/repository';
import {
  distanceUnitOrDefault,
  newId,
  type Car,
  type FuelEntry,
  type Photo,
  type Visit,
} from '@/lib/garage/model';
import {
  FUEL_TYPES,
  VOLUME_UNITS,
  carStations,
  computeTotalCents,
  computeUnitPriceMilli,
  computeVolumeMilli,
  defaultVolumeUnit,
  formatMilli,
  fuelOdometerInOrder,
  lastFuelEntry,
  parseMilli,
  type FuelType,
  type VolumeUnit,
} from '@/lib/fuel/fuel';
import { CURRENCIES, parseCents, validDate, type Currency } from '@/lib/currency/currency';
import { normalizeVehicleKey } from '@/lib/vehicles/vehicle-catalog';
import { failureOf, type AppFailure } from '@/lib/utils/app-error';
import { todayISO } from '@/lib/utils/today-iso';
import { MoneyInput } from '../ui/money-input';
import { Modal } from '../ui/modal';
import { EditableCombobox } from '../ui/editable-combobox';
import { PhotoPicker, usePhotoAttachments } from '../ui/photo-attachments';
import { useFormInteraction } from '../interaction/use-form-interaction';

type AmountField = 'volume' | 'price' | 'total';
const AMOUNT_FIELDS: AmountField[] = ['volume', 'price', 'total'];

// Unit, gas type, currency, and station usually repeat, so new fill-ups start from the last one.
function carDefaults(car: Car | undefined, entries: FuelEntry[], homeCurrency: Currency) {
  const last = car ? lastFuelEntry(car.id, entries) : null;
  return {
    volumeUnit: last?.volumeUnit ?? defaultVolumeUnit(car),
    fuelType: last?.fuelType ?? ('regular' as FuelType),
    currency: last?.currency ?? homeCurrency,
    station: last?.station ?? '',
  };
}

export function FuelModal({
  item,
  carId,
  cars,
  visits,
  fuelEntries,
  repository,
  onClose,
  onSave,
  cloud = false,
  homeCurrency = 'USD',
}: {
  item?: FuelEntry;
  carId?: string;
  cars: Car[];
  visits: Visit[];
  fuelEntries: FuelEntry[];
  repository: Repository;
  onClose: () => void;
  onSave: (entry: FuelEntry) => Promise<void>;
  cloud?: boolean;
  homeCurrency?: Currency;
}) {
  const t = useTranslations();
  cars = [...cars].sort((a, b) => Number(a.isArchived) - Number(b.isArchived));
  const initialCar = cars.find((car) => car.id === (item?.carId ?? carId ?? cars[0]?.id));
  const defaults = carDefaults(initialCar, fuelEntries, homeCurrency);
  const [selectedCarId, setSelectedCarId] = useState(initialCar?.id ?? '');
  const [date, setDate] = useState(item?.date ?? todayISO());
  const [odometer, setOdometer] = useState(
    String(item?.odometer ?? (initialCar ? latestOdometer(initialCar, visits, fuelEntries) : '')),
  );
  const [amounts, setAmounts] = useState<Record<AmountField, string>>({
    volume: item ? formatMilli(item.volumeMilli) : '',
    price: item ? formatMilli(item.unitPriceMilli) : '',
    total: item ? (item.totalCostCents / 100).toFixed(2) : '',
  });
  // Most recently typed amounts first. The field outside the latest two is calculated, unless
  // the person typed over a calculated value, which then stays as entered.
  const [typed, setTyped] = useState<AmountField[]>(item ? ['volume', 'price'] : []);
  const [calculated, setCalculated] = useState<AmountField | null>(null);
  const [volumeUnit, setVolumeUnit] = useState<VolumeUnit>(item?.volumeUnit ?? defaults.volumeUnit);
  const [fuelType, setFuelType] = useState<FuelType>(item?.fuelType ?? defaults.fuelType);
  const [currency, setCurrency] = useState<Currency>(item?.currency ?? defaults.currency);
  const [isFullTank, setIsFullTank] = useState(item?.isFullTank ?? true);
  const [missedPrevious, setMissedPrevious] = useState(item?.missedPrevious ?? false);
  const [station, setStation] = useState(item?.station ?? defaults.station);
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<AppFailure | null>(null);
  const attachments = usePhotoAttachments(item?.photos ?? [], setFormError);
  const { preparing, preparation } = attachments;
  const interaction = useFormInteraction(
    {
      selectedCarId,
      date,
      odometer,
      amounts,
      volumeUnit,
      fuelType,
      currency,
      isFullTank,
      missedPrevious,
      station,
      notes,
      ...attachments.state,
    },
    { busy: busy || preparing },
  );
  const close = () => interaction.request(onClose);
  const selectedCar = cars.find((car) => car.id === selectedCarId);
  const distanceUnit = distanceUnitOrDefault(selectedCar?.distanceUnit);
  const unitLabel = t(`units.${volumeUnit}Short`);
  const stationSuggestions = useMemo(
    () =>
      carStations(selectedCarId, fuelEntries).map((name) => ({
        id: name,
        lookup_key: normalizeVehicleKey(name),
        display_name: name,
      })),
    [selectedCarId, fuelEntries],
  );

  function calculate(field: AmountField, values: Record<AmountField, string>): string | null {
    const volume = parseMilli(values.volume);
    const price = parseMilli(values.price);
    const total = values.total.trim() === '' ? null : parseCents(values.total);
    if (field === 'total' && volume !== null && price !== null)
      return (computeTotalCents(volume, price) / 100).toFixed(2);
    if (field === 'price' && volume !== null && total !== null) {
      const result = computeUnitPriceMilli(total, volume);
      return result === null ? null : formatMilli(result);
    }
    if (field === 'volume' && price !== null && total !== null) {
      const result = computeVolumeMilli(total, price);
      return result === null ? null : formatMilli(result);
    }
    return null;
  }

  function changeAmount(field: AmountField, value: string) {
    const values = { ...amounts, [field]: value };
    const order = [field, ...typed.filter((entry) => entry !== field)];
    setTyped(order);
    if (field === calculated) {
      setCalculated(null);
      setAmounts(values);
      return;
    }
    const target =
      order.length >= 2 ? AMOUNT_FIELDS.find((entry) => !order.slice(0, 2).includes(entry)) : null;
    const result = target ? calculate(target, values) : null;
    if (target && result !== null) {
      values[target] = result;
      setCalculated(target);
    }
    setAmounts(values);
  }

  function chooseCar(id: string) {
    setSelectedCarId(id);
    const car = cars.find((entry) => entry.id === id);
    setOdometer(car ? String(latestOdometer(car, visits, fuelEntries)) : '');
    const next = carDefaults(car, fuelEntries, homeCurrency);
    setVolumeUnit(next.volumeUnit);
    setFuelType(next.fuelType);
    setCurrency(next.currency);
    setStation(next.station);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const reading = odometer.trim() === '' ? NaN : Number(odometer);
    let volume = parseMilli(amounts.volume);
    let price = parseMilli(amounts.price);
    let total = amounts.total.trim() === '' ? null : parseCents(amounts.total);
    // A single missing amount is still calculable from the other two.
    if (total === null && volume !== null && price !== null)
      total = computeTotalCents(volume, price);
    if (price === null && volume !== null && total !== null)
      price = computeUnitPriceMilli(total, volume);
    if (volume === null && price !== null && total !== null)
      volume = computeVolumeMilli(total, price);
    if (
      !selectedCarId ||
      !Number.isInteger(reading) ||
      reading < 0 ||
      volume === null ||
      volume <= 0 ||
      price === null ||
      total === null ||
      !validDate(date) ||
      date > todayISO()
    ) {
      setFormError({ code: 'fuelFields' });
      return;
    }
    const id = item?.id ?? newId();
    const draft: FuelEntry = {
      id,
      carId: selectedCarId,
      date,
      odometer: reading,
      volumeMilli: volume,
      volumeUnit,
      fuelType,
      unitPriceMilli: price,
      totalCostCents: total,
      currency,
      isFullTank,
      missedPrevious,
      station: station.trim(),
      notes: notes.trim(),
      photos: [],
      createdAt: item?.createdAt ?? new Date().toISOString(),
    };
    if (!fuelOdometerInOrder(draft, fuelEntries)) {
      setFormError({ code: 'fuelOdometerOrder' });
      return;
    }
    if (preparation.current || !interaction.begin()) return;
    setBusy(true);
    const uploaded: Photo[] = [];
    try {
      const photos = await attachments.upload(repository, id, uploaded);
      await onSave({ ...draft, photos });
      interaction.accept();
    } catch (cause) {
      await attachments.cleanup(repository, uploaded);
      setFormError(failureOf(cause, 'save'));
    } finally {
      interaction.end();
      setBusy(false);
      attachments.finish();
    }
  }

  return (
    <Modal
      title={item ? t('fuel.edit') : t('fuel.log')}
      subtitle={t('fuel.subtitle')}
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
                  onChange={(e) => chooseCar(e.target.value)}
                  required
                  disabled={Boolean(item)}
                >
                  {cars.map((car) => (
                    <option key={car.id} value={car.id}>
                      {car.name}
                      {car.isArchived && ` (${t('archive.archived')})`}
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
                {t('fuel.odometer', { unit: t(`units.${distanceUnit}`) })}
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={odometer}
                  onChange={(e) => setOdometer(e.target.value)}
                  required
                />
              </label>
              <label>
                {t('fuel.fuelType')}
                <select value={fuelType} onChange={(e) => setFuelType(e.target.value as FuelType)}>
                  {FUEL_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`fuel.types.${type}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-grid">
              <label>
                {t('fuel.volume')}
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={amounts.volume}
                  onChange={(e) => changeAmount('volume', e.target.value)}
                  placeholder="0.000"
                />
              </label>
              <label>
                {t('fuel.volumeUnit')}
                <select
                  value={volumeUnit}
                  onChange={(e) => setVolumeUnit(e.target.value as VolumeUnit)}
                >
                  {VOLUME_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {t(`units.${unit}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-grid">
              <label>
                {t('currency.receipt')}
                <select
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value as Currency)}
                >
                  {CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code} — {t(`currency.${code}`)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="form-grid">
              <label>
                {t('fuel.unitPrice', { unit: unitLabel, currency })}
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={amounts.price}
                  onChange={(e) => changeAmount('price', e.target.value)}
                  placeholder="0.000"
                />
              </label>
              <label>
                {t('fuel.total', { currency })}
                <MoneyInput
                  label={t('fuel.total', { currency })}
                  value={amounts.total}
                  onChange={(value) => changeAmount('total', value)}
                  placeholder="0.00"
                />
              </label>
            </div>
            <p className="section-hint">{t('fuel.computeHint')}</p>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={isFullTank}
                onChange={(e) => setIsFullTank(e.target.checked)}
              />
              <span>
                {t('fuel.fullTank')} <span className="optional">{t('fuel.fullTankHint')}</span>
              </span>
            </label>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={missedPrevious}
                onChange={(e) => setMissedPrevious(e.target.checked)}
              />
              <span>
                {t('fuel.missedPrevious')}{' '}
                <span className="optional">{t('fuel.missedPreviousHint')}</span>
              </span>
            </label>
            <EditableCombobox
              label={t('fuel.station')}
              hint={t('shared.optional')}
              value={station}
              onChange={setStation}
              suggestions={stationSuggestions}
              placeholder={t('fuel.stationExample')}
              required={false}
              maxLength={100}
            />
            <label>
              <span className="field-label">
                {t('shared.notes')} <span className="optional">{t('shared.optional')}</span>
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder={t('fuel.notesExample')}
                maxLength={2000}
              />
            </label>
            <PhotoPicker
              attachments={attachments}
              busy={busy}
              cloud={cloud}
              savingLabel={t('interactions.savingFuel')}
            />
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
              {busy ? t('shared.saving') : item ? t('shared.saveChanges') : t('fuel.save')}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
