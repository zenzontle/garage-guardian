'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DollarSign } from 'lucide-react';
import { type Car, type Expense, type FuelEntry, type Visit } from '@/lib/garage/model';
import { distanceDriven, reportTotals, type SpendingType } from '@/lib/reports/reports';
import { useDisplay } from '@/i18n/use-display';
import { PageHeading } from '../ui/page-heading';
import { CarOptions } from '../ui/select-options';
import { EmptyPanel } from '../ui/empty-panel';
import { Skeleton } from '../ui/skeleton';
import { SkeletonRows } from '../ui/skeleton-rows';
import type { Currency } from '@/lib/currency/currency';

const NO_FUEL: FuelEntry[] = [];
const NO_EXPENSES: Expense[] = [];

export function ReportsPage({
  loading = false,
  cars,
  visits,
  fuelEntries = NO_FUEL,
  expenses = NO_EXPENSES,
  homeCurrency = 'USD',
}: {
  /** Renders the layout with placeholders where records go. */
  loading?: boolean;
  cars: Car[];
  visits: Visit[];
  fuelEntries?: FuelEntry[];
  expenses?: Expense[];
  homeCurrency?: Currency;
}) {
  const t = useTranslations();
  const { money: formatMoney, month: formatMonth, formatDistance } = useDisplay();
  const money = (cents: number) => formatMoney(cents, homeCurrency);
  const [carId, setCarId] = useState('');
  const [year, setYear] = useState('');
  const years = [
    ...new Set([...visits, ...fuelEntries, ...expenses].map((record) => record.date.slice(0, 4))),
  ]
    .sort()
    .reverse();
  const matches = (record: { carId: string; date: string }) =>
    (!carId || record.carId === carId) && (!year || record.date.startsWith(year));
  const filtered = visits.filter(matches);
  const filteredFuel = fuelEntries.filter(matches);
  const filteredExpenses = expenses.filter(matches);
  const recordCount = filtered.length + filteredFuel.length + filteredExpenses.length;
  const totals = reportTotals(filtered, cars, homeCurrency, filteredFuel, filteredExpenses);
  const maxMonth = Math.max(1, ...totals.byMonth.map(([, amount]) => amount));
  const shownCars = cars.filter((car) => !carId || car.id === carId);
  const driven = distanceDriven(shownCars, filtered, filteredFuel);
  const perUnit =
    driven && driven !== 'mixed'
      ? driven.unit
      : shownCars.length && shownCars.every((car) => car.distanceUnit === 'kilometers')
        ? 'kilometers'
        : 'miles';
  // Only the spending of cars whose distance is known goes into the cost per distance.
  const drivenCents =
    driven && driven !== 'mixed'
      ? totals.byCar
          .filter(({ id }) => driven.carIds.includes(id))
          .reduce((sum, { amount }) => sum + amount, 0)
      : 0;
  const typeName = (type: SpendingType) =>
    type.kind === 'expense'
      ? t(`expenses.categories.${type.category}`)
      : t(type.kind === 'service' ? 'reports.service' : 'reports.fuel');
  const statPlaceholder = (
    <>
      <Skeleton className="skeleton-value" width="45%" />
      <Skeleton className="skeleton-small" width="30%" />
    </>
  );
  return (
    <>
      <PageHeading
        eyebrow={t('reports.insights')}
        title={t('navigation.reports')}
        description={t('reports.description')}
      />
      <div className="report-filters">
        <select
          aria-label={t('reports.carFilter')}
          disabled={loading}
          value={carId}
          onChange={(e) => setCarId(e.target.value)}
        >
          <option value="">{t('shared.allCars')}</option>
          <CarOptions cars={cars} />
        </select>
        <select
          aria-label={t('reports.yearFilter')}
          disabled={loading}
          value={year}
          onChange={(e) => setYear(e.target.value)}
        >
          <option value="">{t('reports.allTime')}</option>
          {years.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>
      <div className="report-stat-grid">
        <div className="report-total">
          <span className="eyebrow">{t('reports.totalSpent')}</span>
          {loading ? (
            statPlaceholder
          ) : (
            <>
              <strong>{money(totals.totalCents)}</strong>
              <small>{t('reports.recordCount', { count: recordCount })}</small>
            </>
          )}
        </div>
        <div className="report-total">
          <span className="eyebrow">{t('reports.average')}</span>
          {loading ? (
            statPlaceholder
          ) : (
            <>
              <strong>
                {money(
                  totals.convertedCount
                    ? Math.round(totals.serviceCents / totals.convertedCount)
                    : 0,
                )}
              </strong>
              <small>{t('reports.loggedVisits')}</small>
            </>
          )}
        </div>
        <div className="report-total">
          <span className="eyebrow">
            {t(
              driven === 'mixed'
                ? 'reports.costPerDistance'
                : perUnit === 'kilometers'
                  ? 'reports.costPerKilometer'
                  : 'reports.costPerMile',
            )}
          </span>
          {loading ? (
            statPlaceholder
          ) : driven && driven !== 'mixed' ? (
            <>
              <strong>{money(Math.round(drivenCents / driven.distance))}</strong>
              <small>
                {t('reports.distanceDriven', {
                  distance: formatDistance(driven.distance, driven.unit),
                })}
              </small>
            </>
          ) : (
            <>
              <strong>—</strong>
              <small>{t(driven === 'mixed' ? 'reports.mixedUnits' : 'reports.noDistance')}</small>
            </>
          )}
        </div>
      </div>
      {totals.pendingCount > 0 && (
        <p role="status">{t('currency.incomplete', { count: totals.pendingCount })}</p>
      )}
      {loading ? (
        <div className="report-grid">
          <section className="panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">{t('reports.spending')}</span>
                <h2>{t('reports.overTime')}</h2>
              </div>
            </div>
            <SkeletonRows count={5} />
          </section>
          <section className="panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">{t('reports.breakdown')}</span>
                <h2>{t('reports.byType')}</h2>
              </div>
            </div>
            <SkeletonRows count={3} />
          </section>
        </div>
      ) : recordCount ? (
        <div className="report-grid">
          <section className="panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">{t('reports.spending')}</span>
                <h2>{t('reports.overTime')}</h2>
              </div>
            </div>
            <div className="bar-chart tone-spend">
              {totals.byMonth.map(([month, amount]) => (
                <div className="bar-row" key={month}>
                  <span>{formatMonth(month)}</span>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${Math.max(3, (amount / maxMonth) * 100)}%` }}
                    />
                  </div>
                  <strong>{money(amount)}</strong>
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">{t('reports.breakdown')}</span>
                <h2>{t('reports.byType')}</h2>
              </div>
            </div>
            <div className="breakdown-list">
              {totals.byType.map((type) => (
                <div className="breakdown-row" key={`${type.kind}:${type.category ?? ''}`}>
                  <span>{typeName(type)}</span>
                  <strong>{money(type.amount)}</strong>
                </div>
              ))}
            </div>
            <div className="section-heading second">
              <div>
                <span className="eyebrow">{t('reports.breakdown')}</span>
                <h2>{t('reports.byVehicle')}</h2>
              </div>
            </div>
            <div className="breakdown-list">
              {totals.byCar.map(({ id, name, amount }) => (
                <div className="breakdown-row" key={id}>
                  <span>
                    {name ?? t('reports.unknownCar')}
                    {cars.find((car) => car.id === id)?.isArchived && ` (${t('archive.archived')})`}
                  </span>
                  <strong>{money(amount)}</strong>
                </div>
              ))}
            </div>
            {totals.byCategory.length > 0 && (
              <>
                <div className="section-heading second">
                  <div>
                    <span className="eyebrow">{t('reports.breakdown')}</span>
                    <h2>{t('reports.byService')}</h2>
                  </div>
                </div>
                <div className="breakdown-list">
                  {totals.byCategory.map(({ kind, name, amount }) => (
                    <div className="breakdown-row" key={JSON.stringify([kind, name])}>
                      <span>{kind === 'unallocated' ? t('reports.unallocated') : name}</span>
                      <strong>{money(amount)}</strong>
                    </div>
                  ))}
                </div>
                <p className="section-hint">{t('reports.costHint')}</p>
              </>
            )}
          </section>
        </div>
      ) : (
        <div className="tone-spend">
          <EmptyPanel
            icon={<DollarSign size={24} />}
            title={t('reports.empty')}
            description={t('reports.emptyHint')}
          />
        </div>
      )}
    </>
  );
}
