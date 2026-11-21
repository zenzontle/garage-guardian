'use client';

import { useId, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { activeCarsFirst, newId, type Car, type Expense } from '@/lib/garage/model';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_DESCRIPTION_MAX_LENGTH,
  EXPENSE_NOTES_MAX_LENGTH,
  type ExpenseCategory,
} from '@/lib/expenses/expenses';
import { centsToInput, parseCents, validDate, type Currency } from '@/lib/currency/currency';
import { failureOf, type AppFailure } from '@/lib/utils/app-error';
import { todayISO } from '@/lib/utils/today-iso';

// A renewal date must fall after the payment.
const dayAfter = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
import { MoneyInput } from '../ui/money-input';
import { Modal } from '../ui/modal';
import { CarOptions, CurrencyOptions } from '../ui/select-options';
import { useFormInteraction } from '../interaction/use-form-interaction';

export function ExpenseModal({
  item,
  carId,
  next,
  cars,
  onClose,
  onSave,
  homeCurrency = 'USD',
}: {
  item?: Expense;
  carId?: string;
  /** Starts the next payment of this recurring cost, repeating its wording and currency. */
  next?: Expense;
  cars: Car[];
  onClose: () => void;
  onSave: (expense: Expense) => Promise<void>;
  homeCurrency?: Currency;
}) {
  const t = useTranslations();
  cars = activeCarsFirst(cars);
  // A new cost defaults to an active car; an archived one is only used when asked for by id.
  const initialCarId =
    item?.carId ?? next?.carId ?? carId ?? cars.find((car) => !car.isArchived)?.id ?? '';
  const previous = item ? undefined : next;
  const [selectedCarId, setSelectedCarId] = useState(initialCarId);
  const [date, setDate] = useState(item?.date ?? todayISO());
  const [category, setCategory] = useState<ExpenseCategory>(
    item?.category ?? next?.category ?? 'insurance',
  );
  const [description, setDescription] = useState(item?.description ?? previous?.description ?? '');
  const [total, setTotal] = useState(item ? centsToInput(item.totalCostCents) : '');
  const [currency, setCurrency] = useState<Currency>(
    item?.currency ?? previous?.currency ?? homeCurrency,
  );
  const [renewsOn, setRenewsOn] = useState(item?.renewsOn ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<AppFailure | null>(null);
  const interaction = useFormInteraction(
    { selectedCarId, date, category, description, total, currency, renewsOn, notes },
    { busy },
  );
  const close = () => interaction.request(onClose);
  const renewsHint = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const cents = total.trim() === '' ? null : parseCents(total);
    if (
      !selectedCarId ||
      cents === null ||
      !validDate(date) ||
      date > todayISO() ||
      (renewsOn !== '' && (!validDate(renewsOn) || renewsOn <= date))
    ) {
      setFormError({ code: 'expenseFields' });
      return;
    }
    if (!interaction.begin()) return;
    setBusy(true);
    try {
      await onSave({
        id: item?.id ?? newId(),
        carId: selectedCarId,
        date,
        category,
        description: description.trim(),
        totalCostCents: cents,
        currency,
        conversions: item?.conversions ?? {},
        renewsOn: renewsOn || null,
        notes: notes.trim(),
        createdAt: item?.createdAt ?? new Date().toISOString(),
      });
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
      title={item ? t('expenses.edit') : t('expenses.log')}
      subtitle={t('expenses.subtitle')}
      onClose={close}
      busy={busy}
    >
      <form onSubmit={submit} aria-busy={busy}>
        <fieldset className="interaction-fields" disabled={busy}>
          <div className="modal-body form-stack">
            <div className="form-grid">
              <label>
                {t('shared.vehicle')}
                <select
                  value={selectedCarId}
                  onChange={(e) => setSelectedCarId(e.target.value)}
                  required
                  disabled={Boolean(item)}
                >
                  {!selectedCarId && (
                    <option value="" disabled>
                      {t('car.choose')}
                    </option>
                  )}
                  <CarOptions cars={cars} />
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
                {t('expenses.category')}
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                >
                  {EXPENSE_CATEGORIES.map((value) => (
                    <option key={value} value={value}>
                      {t(`expenses.categories.${value}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="field-label">
                  {t('expenses.descriptionLabel')}{' '}
                  <span className="optional">{t('shared.optional')}</span>
                </span>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('expenses.descriptionExample')}
                  maxLength={EXPENSE_DESCRIPTION_MAX_LENGTH}
                />
              </label>
            </div>
            <div className="form-grid">
              <label>
                {t('expenses.amount', { currency })}
                <MoneyInput
                  label={t('expenses.amount', { currency })}
                  value={total}
                  onChange={setTotal}
                  placeholder="0.00"
                />
              </label>
              <label>
                {t('currency.receipt')}
                <select
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value as Currency)}
                >
                  <CurrencyOptions />
                </select>
              </label>
            </div>
            <label>
              <span className="field-label">
                {t('expenses.renewsOn')} <span className="optional">{t('shared.optional')}</span>
              </span>
              <input
                type="date"
                value={renewsOn}
                min={validDate(date) ? dayAfter(date) : undefined}
                onChange={(e) => setRenewsOn(e.target.value)}
                aria-describedby={renewsHint}
              />
            </label>
            <p className="section-hint" id={renewsHint}>
              {t('expenses.renewsHint')}
            </p>
            <label>
              <span className="field-label">
                {t('shared.notes')} <span className="optional">{t('shared.optional')}</span>
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder={t('expenses.notesExample')}
                maxLength={EXPENSE_NOTES_MAX_LENGTH}
              />
            </label>
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
              {busy ? t('shared.saving') : item ? t('shared.saveChanges') : t('expenses.save')}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
