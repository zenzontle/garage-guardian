'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DollarSign } from 'lucide-react';
import { type Car, type Visit } from '@/lib/garage/model';
import { reportTotals } from '@/lib/reports/reports';
import { useDisplay } from '@/i18n/use-display';
import { PageHeading } from '../ui/page-heading';
import { EmptyPanel } from '../ui/empty-panel';
import type { Currency } from '@/lib/currency/currency';

export function ReportsPage({
  cars,
  visits,
  homeCurrency = 'USD',
}: {
  cars: Car[];
  visits: Visit[];
  homeCurrency?: Currency;
}) {
  const t = useTranslations();
  const { money: formatMoney, month: formatMonth } = useDisplay();
  const money = (cents: number) => formatMoney(cents, homeCurrency);
  const [carId, setCarId] = useState('');
  const [year, setYear] = useState('');
  const years = [...new Set(visits.map((visit) => visit.date.slice(0, 4)))].sort().reverse();
  const filtered = visits.filter(
    (visit) => (!carId || visit.carId === carId) && (!year || visit.date.startsWith(year)),
  );
  const totals = reportTotals(filtered, cars, homeCurrency);
  const maxMonth = Math.max(1, ...totals.byMonth.map(([, amount]) => amount));
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
          value={carId}
          onChange={(e) => setCarId(e.target.value)}
        >
          <option value="">{t('shared.allCars')}</option>
          {cars.map((car) => (
            <option key={car.id} value={car.id}>
              {car.name}
              {car.isArchived && ` (${t('archive.archived')})`}
            </option>
          ))}
        </select>
        <select
          aria-label={t('reports.yearFilter')}
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
          <strong>{money(totals.totalCents)}</strong>
          <small>{t('reports.visitCount', { count: filtered.length })}</small>
        </div>
        <div className="report-total">
          <span className="eyebrow">{t('reports.average')}</span>
          <strong>
            {money(
              totals.convertedCount ? Math.round(totals.totalCents / totals.convertedCount) : 0,
            )}
          </strong>
          <small>{t('reports.loggedVisits')}</small>
        </div>
      </div>
      {totals.pendingCount > 0 && (
        <p role="status">{t('currency.incomplete', { count: totals.pendingCount })}</p>
      )}
      {filtered.length ? (
        <div className="report-grid">
          <section className="panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">{t('reports.spending')}</span>
                <h2>{t('reports.overTime')}</h2>
              </div>
            </div>
            <div className="bar-chart">
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
          </section>
        </div>
      ) : (
        <EmptyPanel
          icon={<DollarSign size={24} />}
          title={t('reports.empty')}
          description={t('reports.emptyHint')}
        />
      )}
    </>
  );
}
