'use client';

import { useTranslations } from 'next-intl';
import { ArrowDownToLine, Plus, Settings2, Trash2, Wallet } from 'lucide-react';
import type { Car, Expense } from '@/lib/garage/model';
import type { Currency } from '@/lib/currency/currency';
import { expensesToCsv } from '@/lib/reports/reports';
import { downloadUrl } from '@/lib/utils/download-url';
import { useDisplay } from '@/i18n/use-display';
import { PageHeading } from '../ui/page-heading';
import { CarOptions } from '../ui/select-options';
import { EmptyPanel } from '../ui/empty-panel';
import { Skeleton } from '../ui/skeleton';
import { SkeletonRows } from '../ui/skeleton-rows';

export function CostsPage({
  loading = false,
  cars,
  expenses,
  carId,
  homeCurrency = 'USD',
  onCarChange,
  onAdd,
  onAddCar,
  onEdit,
  onDelete,
}: {
  /** Renders the layout with placeholders where records go. */
  loading?: boolean;
  cars: Car[];
  expenses: Expense[];
  carId: string;
  homeCurrency?: Currency;
  onCarChange: (carId: string) => void;
  onAdd: () => void;
  onAddCar: () => void;
  onEdit: (expense: Expense) => void;
  onDelete: (expense: Expense) => void;
}) {
  const t = useTranslations();
  const { money, displayDate } = useDisplay();
  const activeCars = cars.filter((car) => !car.isArchived);
  const filtered = expenses.filter((expense) => !carId || expense.carId === carId);
  const name = (expense: Expense) => t(`expenses.categories.${expense.category}`);
  const carOf = (expense: Expense) => cars.find((car) => car.id === expense.carId);
  function downloadCsv() {
    const blob = new Blob([expensesToCsv(filtered, cars, homeCurrency)], {
      type: 'text/csv;charset=utf-8',
    });
    downloadUrl(URL.createObjectURL(blob), 'garage-guardian-other-costs.csv');
  }
  const actions = (expense: Expense, compact: boolean) => (
    <div className="row-actions">
      <button
        className={compact ? 'icon-button' : 'button secondary'}
        onClick={() => onEdit(expense)}
        aria-label={compact ? t('expenses.editEntry', { name: name(expense) }) : undefined}
      >
        <Settings2 size={16} aria-hidden="true" />
        {!compact && t('expenses.editEntry', { name: name(expense) })}
      </button>
      <button
        className={compact ? 'icon-button danger' : 'button secondary danger-text'}
        onClick={() => onDelete(expense)}
        aria-label={compact ? t('expenses.deleteEntry', { name: name(expense) }) : undefined}
      >
        <Trash2 size={16} aria-hidden="true" />
        {!compact && t('expenses.deleteEntry', { name: name(expense) })}
      </button>
    </div>
  );
  return (
    <>
      <PageHeading
        eyebrow={t('expenses.eyebrow')}
        title={t('navigation.costs')}
        description={t('expenses.description')}
        action={
          loading ? (
            <Skeleton className="skeleton-button" width="8rem" />
          ) : activeCars.length ? (
            <button className="button primary tone-spend" onClick={onAdd}>
              <Plus size={18} />
              {t('expenses.log')}
            </button>
          ) : (
            <button className="button primary" onClick={onAddCar}>
              <Plus size={18} />
              {t('shared.addCar')}
            </button>
          )
        }
      />
      <div className="panel table-panel tone-spend">
        <div className="table-toolbar history-toolbar">
          <label className="history-filter">
            <span>{t('expenses.filterCar')}</span>
            <select
              aria-label={t('expenses.filterCar')}
              disabled={loading}
              value={carId}
              onChange={(e) => onCarChange(e.target.value)}
            >
              <option value="">{t('shared.allCars')}</option>
              <CarOptions cars={cars} />
            </select>
          </label>
          <button
            className="button secondary"
            onClick={downloadCsv}
            disabled={loading || !filtered.length}
          >
            <ArrowDownToLine size={17} />
            {t('expenses.export')}
          </button>
        </div>
        {loading ? (
          <SkeletonRows count={5} />
        ) : filtered.length ? (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>{t('shared.date')}</th>
                    <th>{t('shared.vehicle')}</th>
                    <th>{t('expenses.category')}</th>
                    <th>{t('expenses.renews')}</th>
                    <th>{t('history.cost')}</th>
                    <th>
                      <span className="sr-only">{t('history.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((expense) => (
                    <tr key={expense.id}>
                      <td>{displayDate(expense.date)}</td>
                      <td>
                        <strong>{carOf(expense)?.name ?? t('expenses.unknown')}</strong>
                        {carOf(expense)?.isArchived && (
                          <span className="count-badge">{t('archive.archived')}</span>
                        )}
                      </td>
                      <td>
                        {name(expense)}
                        {expense.description && <small>{expense.description}</small>}
                      </td>
                      <td>{expense.renewsOn ? displayDate(expense.renewsOn) : '—'}</td>
                      <td>
                        <strong>{money(expense.totalCostCents, expense.currency)}</strong>
                      </td>
                      <td>{actions(expense, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="history-cards" role="list" aria-label={t('navigation.costs')}>
              {filtered.map((expense) => (
                <li className="history-card" key={expense.id}>
                  <div className="history-card-heading">
                    <div>
                      <time dateTime={expense.date}>{displayDate(expense.date)}</time>
                      <strong>{carOf(expense)?.name ?? t('expenses.unknown')}</strong>
                      {carOf(expense)?.isArchived && (
                        <span className="count-badge">{t('archive.archived')}</span>
                      )}
                    </div>
                    <strong>{money(expense.totalCostCents, expense.currency)}</strong>
                  </div>
                  <dl className="history-card-facts">
                    <div>
                      <dt>{t('expenses.category')}</dt>
                      <dd>
                        {name(expense)}
                        {expense.description && ` · ${expense.description}`}
                      </dd>
                    </div>
                    <div>
                      <dt>{t('expenses.renews')}</dt>
                      <dd>{expense.renewsOn ? displayDate(expense.renewsOn) : '—'}</dd>
                    </div>
                  </dl>
                  {expense.notes && <p className="section-hint">{expense.notes}</p>}
                  {actions(expense, false)}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <EmptyPanel
            icon={<Wallet size={23} />}
            title={expenses.length ? t('expenses.noMatches') : t('expenses.empty')}
            description={expenses.length ? t('expenses.changeFilter') : t('expenses.firstEntry')}
          />
        )}
        <div className="table-footer">
          {loading ? (
            <Skeleton className="skeleton-small" width="8rem" />
          ) : (
            t('expenses.showing', { count: filtered.length, total: expenses.length })
          )}
        </div>
      </div>
    </>
  );
}
