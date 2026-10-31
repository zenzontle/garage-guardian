'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Fuel, Plus } from 'lucide-react';
import type { Repository } from '@/lib/garage/repository';
import type { Car, FuelEntry } from '@/lib/garage/model';
import { fuelEconomy } from '@/lib/fuel/economy';
import { PageHeading } from '../ui/page-heading';
import { EmptyPanel } from '../ui/empty-panel';
import { Stat } from '../ui/stat';
import { FuelCard } from './fuel-card';
import { FuelRow } from './fuel-row';
import { useFuelDisplay } from './use-fuel-display';

export function FuelPage({
  cars,
  fuelEntries,
  repository,
  carId,
  onCarChange,
  onAdd,
  onEdit,
  onDelete,
}: {
  cars: Car[];
  fuelEntries: FuelEntry[];
  repository: Repository;
  carId: string;
  onCarChange: (carId: string) => void;
  onAdd: () => void;
  onEdit: (entry: FuelEntry) => void;
  onDelete: (entry: FuelEntry) => void;
}) {
  const t = useTranslations();
  const fuel = useFuelDisplay();
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
          <button className="button primary tone-fuel" onClick={onAdd} disabled={!cars.length}>
            <Plus size={18} />
            {t('fuel.log')}
          </button>
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
      <div className="panel table-panel tone-fuel">
        <div className="table-toolbar history-toolbar">
          <label className="history-filter">
            <span>{t('fuel.filterCar')}</span>
            <select
              aria-label={t('fuel.filterCar')}
              value={carId}
              onChange={(e) => onCarChange(e.target.value)}
            >
              <option value="">{t('shared.allCars')}</option>
              {cars.map((car) => (
                <option key={car.id} value={car.id}>
                  {car.name}
                  {car.isArchived && ` (${t('archive.archived')})`}
                </option>
              ))}
            </select>
          </label>
        </div>
        {filtered.length ? (
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
          {t('fuel.showing', { count: filtered.length, total: fuelEntries.length })}
        </div>
      </div>
    </>
  );
}
