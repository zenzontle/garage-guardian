'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDownToLine, Fuel, Plus } from 'lucide-react';
import type { Repository } from '@/lib/garage/repository';
import type { Car, FuelEntry } from '@/lib/garage/model';
import { fuelEconomy } from '@/lib/fuel/economy';
import { fuelToCsv } from '@/lib/reports/reports';
import { downloadUrl } from '@/lib/utils/download-url';
import type { Currency } from '@/lib/currency/currency';
import { PageHeading } from '../ui/page-heading';
import { CarOptions } from '../ui/select-options';
import { EmptyPanel } from '../ui/empty-panel';
import { Stat } from '../ui/stat';
import { Skeleton } from '../ui/skeleton';
import { SkeletonRows } from '../ui/skeleton-rows';
import { FuelCard } from './fuel-card';
import { FuelRow } from './fuel-row';
import { FuelTrend } from './fuel-trend';
import { useFuelDisplay } from './use-fuel-display';

export function FuelPage({
  loading = false,
  cars,
  fuelEntries,
  repository,
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
  fuelEntries: FuelEntry[];
  repository: Repository;
  carId: string;
  homeCurrency?: Currency;
  onCarChange: (carId: string) => void;
  onAdd: () => void;
  onAddCar: () => void;
  onEdit: (entry: FuelEntry) => void;
  onDelete: (entry: FuelEntry) => void;
}) {
  const t = useTranslations();
  const fuel = useFuelDisplay();
  const activeCars = cars.filter((car) => !car.isArchived);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  function toggle(id: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const economies = useMemo(
    () => new Map(cars.map((car) => [car.id, fuelEconomy(car, fuelEntries)])),
    [cars, fuelEntries],
  );
  const filtered = fuelEntries.filter((entry) => !carId || entry.carId === carId);
  const averageCars = cars.filter(
    (car) => (!carId || car.id === carId) && fuelEntries.some((entry) => entry.carId === car.id),
  );
  // The trend follows the chosen vehicle, or the only one with fill-ups.
  const trendCar = carId
    ? cars.find((car) => car.id === carId)
    : averageCars.length === 1
      ? averageCars[0]
      : undefined;
  const trendEconomy = trendCar ? economies.get(trendCar.id) : undefined;
  function downloadCsv() {
    const csv = fuelToCsv(
      filtered,
      cars,
      homeCurrency,
      (entry) => economies.get(entry.carId)?.byEntry.get(entry.id) ?? null,
    );
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    downloadUrl(URL.createObjectURL(blob), 'garage-guardian-fuel-log.csv');
  }
  const props = (entry: FuelEntry) => ({
    entry,
    car: cars.find((car) => car.id === entry.carId),
    economy: economies.get(entry.carId),
    repository,
    expanded: expanded.has(entry.id),
    onToggle: () => toggle(entry.id),
    onEdit: () => onEdit(entry),
    onDelete: () => onDelete(entry),
  });
  return (
    <>
      <PageHeading
        eyebrow={t('fuel.eyebrow')}
        title={t('navigation.fuel')}
        description={t('fuel.description')}
        action={
          loading ? (
            <Skeleton className="skeleton-button" width="8rem" />
          ) : activeCars.length ? (
            <button className="button primary tone-fuel" onClick={onAdd}>
              <Plus size={18} />
              {t('fuel.log')}
            </button>
          ) : (
            <button className="button primary" onClick={onAddCar}>
              <Plus size={18} />
              {t('shared.addCar')}
            </button>
          )
        }
      />
      {averageCars.length > 0 && (
        <div className="stat-grid">
          {averageCars.map((car) => {
            const economy = economies.get(car.id)!;
            return (
              <Stat
                key={car.id}
                icon={<Fuel size={20} />}
                label={car.name}
                value={fuel.economy(economy.average, economy.unit)}
                detail={economy.average === null ? t('fuel.noEconomy') : t('fuel.average')}
                tone="fuel"
              />
            );
          })}
        </div>
      )}
      {!loading && averageCars.length > 0 && (
        <section className="panel tone-fuel fuel-trend-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">{t('fuel.trendEyebrow')}</span>
              <h2>
                {t('fuel.trend')}
                {trendCar && ` · ${trendCar.name}`}
              </h2>
            </div>
          </div>
          {trendCar && trendEconomy ? (
            <>
              <FuelTrend car={trendCar} entries={fuelEntries} economy={trendEconomy} />
              <p className="section-hint">
                {t('fuel.trendHint', {
                  direction: t(trendEconomy.unit === 'mpg' ? 'fuel.betterUp' : 'fuel.betterDown'),
                })}
              </p>
            </>
          ) : (
            <p className="section-hint">{t('fuel.trendChoose')}</p>
          )}
        </section>
      )}
      <div className="panel table-panel tone-fuel">
        <div className="table-toolbar history-toolbar">
          <label className="history-filter">
            <span>{t('fuel.filterCar')}</span>
            <select
              aria-label={t('fuel.filterCar')}
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
            {t('fuel.export')}
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
                    <th>{t('history.odometer')}</th>
                    <th>{t('fuel.volume')}</th>
                    <th>{t('fuel.fuelType')}</th>
                    <th>{t('fuel.price')}</th>
                    <th>{t('history.cost')}</th>
                    <th>{t('fuel.economy')}</th>
                    <th>
                      <span className="sr-only">{t('history.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((entry) => (
                    <FuelRow key={entry.id} {...props(entry)} />
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="history-cards" role="list" aria-label={t('navigation.fuel')}>
              {filtered.map((entry) => (
                <FuelCard key={entry.id} {...props(entry)} />
              ))}
            </ul>
          </>
        ) : (
          <EmptyPanel
            icon={<Fuel size={23} />}
            title={fuelEntries.length ? t('fuel.noMatches') : t('fuel.empty')}
            description={fuelEntries.length ? t('fuel.changeFilter') : t('fuel.firstEntry')}
          />
        )}
        <div className="table-footer">
          {loading ? (
            <Skeleton className="skeleton-small" width="8rem" />
          ) : (
            t('fuel.showing', { count: filtered.length, total: fuelEntries.length })
          )}
        </div>
      </div>
    </>
  );
}
