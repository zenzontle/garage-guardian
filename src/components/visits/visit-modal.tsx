'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, X } from 'lucide-react';
import { latestOdometer } from '@/lib/maintenance/due';
import { type Repository } from '@/lib/garage/repository';
import {
  distanceUnitOrDefault,
  newId,
  type Car,
  type FuelEntry,
  type ScheduleItem,
  type Visit,
  type VisitItem,
  type Photo,
} from '@/lib/garage/model';
import { MoneyInput } from '../ui/money-input';
import { failureOf, type AppFailure } from '@/lib/utils/app-error';
import { Modal } from '../ui/modal';
import { PhotoPicker, usePhotoAttachments } from '../ui/photo-attachments';
import { useFormInteraction } from '../interaction/use-form-interaction';
import { todayISO } from '@/lib/utils/today-iso';
import {
  CURRENCIES,
  currencyOrDefault,
  normalizeVisit,
  parseCents,
  validDate,
  type Currency,
} from '@/lib/currency/currency';
import { useReceiptConversion } from '@/lib/currency/use-receipt-conversion';

type EditVisitItem = VisitItem & { key: string; costInput: string };

export function VisitModal({
  item,
  carId,
  cars,
  visits,
  fuelEntries = [],
  schedules,
  repository,
  onClose,
  onSave,
  cloud = false,
  homeCurrency = 'USD',
}: {
  item?: Visit;
  cloud?: boolean;
  homeCurrency?: Currency;
  carId?: string;
  cars: Car[];
  visits: Visit[];
  fuelEntries?: FuelEntry[];
  schedules: ScheduleItem[];
  repository: Repository;
  onClose: () => void;
  onSave: (visit: Visit, manualTargets?: Currency[]) => Promise<void>;
}) {
  const t = useTranslations();
  cars = [...cars].sort((a, b) => Number(a.isArchived) - Number(b.isArchived));
  const initialCar = cars.find((car) => car.id === (item?.carId ?? carId ?? cars[0]?.id));
  const [selectedCarId, setSelectedCarId] = useState(item?.carId ?? carId ?? cars[0]?.id ?? '');
  const [date, setDate] = useState(item?.date ?? todayISO());
  const [odometer, setOdometer] = useState(
    item
      ? String(item.odometer ?? '')
      : String(initialCar ? latestOdometer(initialCar, visits, fuelEntries) : ''),
  );
  const [totalCost, setTotalCost] = useState(item ? (item.totalCostCents / 100).toFixed(2) : '');
  const [currency, setCurrency] = useState<Currency>(
    item ? currencyOrDefault(item.currency) : homeCurrency,
  );
  const conversion = useReceiptConversion(item, currency, date, totalCost, homeCurrency);
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
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<AppFailure | null>(null);
  const attachments = usePhotoAttachments(item?.photos ?? [], setFormError);
  const { preparing, preparation } = attachments;
  const interaction = useFormInteraction(
    {
      selectedCarId,
      date,
      odometer,
      totalCost,
      currency,
      convertedTotal: conversion.manualInput,
      provider,
      notes,
      items: items.map(({ name, scheduleItemId, costInput }) => ({
        name,
        scheduleItemId,
        costInput,
      })),
      ...attachments.state,
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
      cents = parseCents(totalCost);
    if (
      !selectedCarId ||
      (miles !== null && (!Number.isInteger(miles) || miles < 0)) ||
      cents === null ||
      !validDate(date) ||
      date > todayISO() ||
      (conversion.manualInput !== null &&
        conversion.manualInput !== '' &&
        !conversion.conversion) ||
      items.some(
        (entry) =>
          entry.name.trim() && entry.costInput !== '' && parseCents(entry.costInput) === null,
      )
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
    const uploaded: Photo[] = [];
    try {
      const visitId = item?.id ?? newId();
      const photos = await attachments.upload(repository, visitId, uploaded);
      await onSave(
        normalizeVisit({
          id: visitId,
          carId: selectedCarId,
          date,
          odometer: miles,
          totalCostCents: cents,
          currency,
          conversions: {
            ...item?.conversions,
            ...(conversion.conversion ? { [homeCurrency]: conversion.conversion } : {}),
          },
          provider: provider.trim(),
          notes: notes.trim(),
          items: cleanItems,
          photos,
          createdAt: item?.createdAt ?? new Date().toISOString(),
        }),
        conversion.manualInput !== null ? [homeCurrency] : [],
      );
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
                    setOdometer(car ? String(latestOdometer(car, visits, fuelEntries)) : '');
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
            <p className="section-hint">{t('currency.linesHint', { currency })}</p>
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
                {t('visit.total', { currency })}
                <MoneyInput
                  label={t('visit.total', { currency })}
                  value={totalCost}
                  onChange={setTotalCost}
                  placeholder="0.00"
                />
              </label>
            </div>
            {currency !== homeCurrency && (
              <div className="form-stack conversion-editor">
                <label>
                  {t('currency.converted', { currency: homeCurrency })}
                  <MoneyInput
                    label={t('currency.converted', { currency: homeCurrency })}
                    value={conversion.value}
                    onChange={conversion.change}
                    placeholder="0.00"
                  />
                </label>
                <p role="status" aria-live="polite" className="section-hint">
                  {conversion.conversion?.source === 'automatic'
                    ? t('currency.estimate', {
                        rate: conversion.conversion.rate!,
                        date: conversion.conversion.rateDate!,
                        base: currency,
                        target: homeCurrency,
                      })
                    : conversion.conversion?.source === 'manual'
                      ? t('currency.manual')
                      : t(
                          conversion.status === 'loading' ? 'currency.loading' : 'currency.pending',
                        )}
                </p>
                <p className="section-hint">{t('currency.overrideHint')}</p>
                {!conversion.conversion && (
                  <button type="button" className="text-link" onClick={conversion.retry}>
                    {t('shared.retry')}
                  </button>
                )}
              </div>
            )}
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
                    label={t('visit.itemCost', { currency })}
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
            <PhotoPicker
              attachments={attachments}
              busy={busy}
              cloud={cloud}
              savingLabel={t('interactions.savingVisit')}
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
              {busy ? t('shared.saving') : item ? t('shared.saveChanges') : t('visit.save')}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
