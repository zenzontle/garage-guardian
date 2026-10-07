'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDownToLine, ClipboardList, Plus, Search } from 'lucide-react';
import { type Repository } from '@/lib/repository';
import { distanceInMiles, type Car, type Visit } from '@/lib/model';
import { visitsToCsv } from '@/lib/reports';
import { PageHeading } from './page-heading';
import { EmptyPanel } from './empty-panel';
import { HistoryRow } from './history-row';

export function HistoryPage({
  cars,
  visits,
  repository,
  onAdd,
  onEdit,
  onDelete,
}: {
  cars: Car[];
  visits: Visit[];
  repository: Repository;
  onAdd: () => void;
  onEdit: (visit: Visit) => void;
  onDelete: (visit: Visit) => void;
}) {
  const t = useTranslations();
  const [carId, setCarId] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sort, setSort] = useState('newest');
  const filtered = visits
    .filter(
      (visit) =>
        (!carId || visit.carId === carId) &&
        (!from || visit.date >= from) &&
        (!to || visit.date <= to) &&
        (!query ||
          `${visit.provider} ${visit.notes} ${visit.items.map((item) => item.name).join(' ')}`
            .toLowerCase()
            .includes(query.toLowerCase())),
    )
    .sort((a, b) => {
      if (sort === 'oldest') return a.date.localeCompare(b.date);
      if (sort === 'cost_high') return b.totalCostCents - a.totalCostCents;
      if (sort === 'cost_low') return a.totalCostCents - b.totalCostCents;
      if (sort === 'odometer_high')
        return (
          distanceInMiles(b.odometer, cars.find((car) => car.id === b.carId)?.distanceUnit) -
          distanceInMiles(a.odometer, cars.find((car) => car.id === a.carId)?.distanceUnit)
        );
      return b.date.localeCompare(a.date);
    });
  function downloadCsv() {
    const blob = new Blob([visitsToCsv(filtered, cars)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'garage-guardian-service-history.csv';
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <PageHeading
        eyebrow={t('history.eyebrow')}
        title={t('navigation.history')}
        description={t('history.description')}
        action={
          <button className="button primary" onClick={onAdd} disabled={!cars.length}>
            <Plus size={18} />
            {t('shared.logService')}
          </button>
        }
      />
      <div className="panel table-panel">
        <div className="table-toolbar">
          <div className="search-field">
            <Search size={18} />
            <input
              aria-label={t('history.search')}
              placeholder={t('history.searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            aria-label={t('history.filterCar')}
            value={carId}
            onChange={(e) => setCarId(e.target.value)}
          >
            <option value="">{t('shared.allCars')}</option>
            {cars.map((car) => (
              <option key={car.id} value={car.id}>
                {car.name}
              </option>
            ))}
          </select>
          <label className="date-filter">
            {t('history.from')}
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="date-filter">
            {t('history.to')}
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <select
            aria-label={t('history.sort')}
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="newest">{t('history.newest')}</option>
            <option value="oldest">{t('history.oldest')}</option>
            <option value="cost_high">{t('history.highCost')}</option>
            <option value="cost_low">{t('history.lowCost')}</option>
            <option value="odometer_high">{t('history.highOdometer')}</option>
          </select>
          <button className="button secondary" onClick={downloadCsv} disabled={!filtered.length}>
            <ArrowDownToLine size={17} />
            {t('history.export')}
          </button>
        </div>
        {filtered.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t('shared.date')}</th>
                  <th>{t('shared.vehicle')}</th>
                  <th>{t('history.service')}</th>
                  <th>{t('history.odometer')}</th>
                  <th>{t('shared.provider')}</th>
                  <th>{t('history.cost')}</th>
                  <th>{t('shared.photos')}</th>
                  <th>
                    <span className="sr-only">{t('history.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((visit) => (
                  <HistoryRow
                    key={visit.id}
                    visit={visit}
                    car={cars.find((car) => car.id === visit.carId)}
                    repository={repository}
                    onEdit={() => onEdit(visit)}
                    onDelete={() => onDelete(visit)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyPanel
            icon={<ClipboardList size={23} />}
            title={visits.length ? t('history.noMatches') : t('history.empty')}
            description={visits.length ? t('history.changeFilters') : t('history.firstVisit')}
          />
        )}
        <div className="table-footer">
          {t('history.showing', { count: filtered.length, total: visits.length })}
        </div>
      </div>
    </>
  );
}
