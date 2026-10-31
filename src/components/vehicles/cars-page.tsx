'use client';

import Link from '../interaction/guarded-link';
import { carPath, fuelPath, historyPath } from '@/lib/navigation/garage-routes';
import { useTranslations } from 'next-intl';
import {
  ArrowRight,
  CarFront,
  ClipboardList,
  Fuel,
  Gauge,
  Plus,
  Settings2,
  Trash2,
  Wrench,
} from 'lucide-react';
import { latestOdometer, type DueItem } from '@/lib/maintenance/due';
import { fuelEconomy } from '@/lib/fuel/economy';
import { type Car, type FuelEntry, type ScheduleItem, type Visit } from '@/lib/garage/model';
import { useFuelDisplay } from '../fuel/use-fuel-display';
import { useDisplay } from '@/i18n/use-display';
import { PageHeading } from '../ui/page-heading';
import { EmptyPanel } from '../ui/empty-panel';
import type { AppFailure } from '@/lib/utils/app-error';

export function CarsPage({
  cars,
  archived,
  hasArchived,
  schedules,
  archiveBusy,
  archiveError,
  onRestore,
  visits,
  fuelEntries,
  allDue,
  selectedCar,
  onAdd,
  onEdit,
  onAddSchedule,
  onEditSchedule,
  onAddVisit,
  onAddFuel,
  onDeleteCar,
  onDeleteSchedule,
}: {
  cars: Car[];
  archived: boolean;
  hasArchived: boolean;
  schedules: ScheduleItem[];
  archiveBusy: boolean;
  archiveError: AppFailure | null;
  onRestore: () => void;
  visits: Visit[];
  fuelEntries: FuelEntry[];
  allDue: DueItem[];
  selectedCar: Car | null;
  onAdd: () => void;
  onEdit: (car: Car) => void;
  onAddSchedule: (carId: string) => void;
  onEditSchedule: (item: ScheduleItem) => void;
  onAddVisit: (carId: string) => void;
  onAddFuel: (carId: string) => void;
  onDeleteCar: (car: Car) => void;
  onDeleteSchedule: (item: ScheduleItem) => void;
}) {
  const t = useTranslations();
  const { number, money, displayDate, formatDistance, dueDescription } = useDisplay();
  const fuel = useFuelDisplay();
  const car = selectedCar;
  const carDue = car ? allDue.filter((item) => item.car.id === car.id) : [];
  const carSchedules = car ? schedules.filter((item) => item.carId === car.id) : [];
  const carVisits = car ? visits.filter((visit) => visit.carId === car.id) : [];
  const carFuel = car ? fuelEntries.filter((entry) => entry.carId === car.id) : [];
  const economy = car ? fuelEconomy(car, carFuel) : null;
  return (
    <>
      <PageHeading
        eyebrow={t('dashboard.yourVehicles')}
        title={t('navigation.cars')}
        description={t('car.description')}
        action={
          <button disabled={archiveBusy} className="button primary" onClick={onAdd}>
            <Plus size={18} />
            {t('shared.addCar')}
          </button>
        }
      />
      {(hasArchived || archived) && (
        <nav className="car-switcher" aria-label={t('archive.views')}>
          <Link
            className={`car-tab ${!archived ? 'active' : ''}`}
            href="/cars"
            aria-current={!archived ? 'page' : undefined}
          >
            {t('archive.active')}
          </Link>
          <Link
            className={`car-tab ${archived ? 'active' : ''}`}
            href="/cars?view=archived"
            aria-current={archived ? 'page' : undefined}
          >
            {t('archive.archivedView')}
          </Link>
        </nav>
      )}
      {!car ? (
        <EmptyPanel
          icon={<CarFront size={25} />}
          title={t(
            archived
              ? 'archive.emptyTitle'
              : hasArchived
                ? 'archive.activeEmptyTitle'
                : 'car.emptyTitle',
          )}
          description={t(
            archived
              ? 'archive.emptyDescription'
              : hasArchived
                ? 'archive.activeEmptyDescription'
                : 'car.emptyDescription',
          )}
          action={
            <div className="account-actions">
              <button disabled={archiveBusy} className="button primary" onClick={onAdd}>
                {t('shared.addCar')}
              </button>
              {!archived && hasArchived && (
                <Link className="button secondary" href="/cars?view=archived">
                  {t('archive.viewArchived')}
                </Link>
              )}
            </div>
          }
        />
      ) : (
        <>
          <nav
            className="car-switcher"
            aria-label={t('car.choose')}
            onFocusCapture={(event) =>
              event.target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
            }
            onKeyDown={(event) => {
              if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
              const links = Array.from(
                event.currentTarget.querySelectorAll<HTMLAnchorElement>('a'),
              );
              const index = links.indexOf(event.target as HTMLAnchorElement);
              if (index < 0) return;
              let next: number;
              switch (event.key) {
                case 'ArrowLeft':
                  next = (index - 1 + links.length) % links.length;
                  break;
                case 'ArrowRight':
                  next = (index + 1) % links.length;
                  break;
                case 'Home':
                  next = 0;
                  break;
                case 'End':
                  next = links.length - 1;
                  break;
                default:
                  return;
              }
              event.preventDefault();
              links[next].focus();
            }}
          >
            {cars.map((item) => (
              <Link
                href={carPath(item.id)}
                aria-current={car.id === item.id ? 'page' : undefined}
                className={`car-tab ${car.id === item.id ? 'active' : ''}`}
                key={item.id}
              >
                <CarFront size={19} />
                <span>{item.name}</span>
              </Link>
            ))}
          </nav>
          <div className="car-header panel">
            <div className="car-header-icon">
              <CarFront size={30} />
            </div>
            <div className="car-header-copy">
              <span className="eyebrow">
                {car.year} {car.make.toUpperCase()} {car.model.toUpperCase()}
              </span>
              <h2>{car.name}</h2>
              {car.isArchived && (
                <>
                  <span className="count-badge">{t('archive.archived')}</span>
                  <p>{t('archive.paused')}</p>
                </>
              )}
              <p>
                <Gauge size={16} />{' '}
                {formatDistance(latestOdometer(car, visits, fuelEntries), car.distanceUnit)}{' '}
                {t('car.currentOdometer')}
                {car.vin && ` · VIN ${car.vin}`}
              </p>
              {car.plate && <p className="car-plate">{t('car.plate', { plate: car.plate })}</p>}
            </div>
            <div className="car-header-actions">
              {car.isArchived && (
                <button
                  className="button secondary"
                  onClick={onRestore}
                  disabled={archiveBusy}
                  aria-busy={archiveBusy}
                >
                  {t(archiveBusy ? 'archive.restoring' : 'archive.restore')}
                </button>
              )}
              <button
                disabled={archiveBusy}
                className="button secondary"
                onClick={() =>
                  onEdit({ ...car, odometer: latestOdometer(car, visits, fuelEntries) })
                }
              >
                <Settings2 size={16} />
                {t('car.edit')}
              </button>
              <button
                disabled={archiveBusy}
                className="button primary tone-fuel"
                onClick={() => onAddFuel(car.id)}
              >
                <Fuel size={16} />
                {t('fuel.log')}
              </button>
              <button
                disabled={archiveBusy}
                className="button primary"
                onClick={() => onAddVisit(car.id)}
              >
                <Plus size={17} />
                {t('shared.logService')}
              </button>
            </div>
          </div>
          {archiveError && (
            <p className="error-text" role="alert">
              {t(`errors.${archiveError.code}`, archiveError.values)}
            </p>
          )}
          <div className="car-content-grid">
            <section className="panel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">{t('car.servicePlan')}</span>
                  <h2>{t('car.maintenanceSchedule')}</h2>
                </div>
                <button
                  disabled={archiveBusy}
                  className="text-link"
                  onClick={() => onAddSchedule(car.id)}
                >
                  <Plus size={16} />
                  {t('car.addTask')}
                </button>
              </div>
              <p className="section-hint">{t('car.scheduleHint')}</p>
              <div className="schedule-list">
                {carSchedules
                  .filter((item) => !carDue.some((due) => due.schedule.id === item.id))
                  .map((item) => (
                    <div className="schedule-row saved-schedule-row" key={item.id}>
                      <div className="schedule-main">
                        <strong>{item.name}</strong>
                        <small>
                          {t(car.isArchived ? 'archive.scheduleSaved' : 'archive.inactiveSchedule')}
                        </small>
                        {item.intervalMiles !== null && (
                          <small>
                            {t('archive.repeatDistance', {
                              distance: formatDistance(item.intervalMiles, car.distanceUnit),
                            })}
                          </small>
                        )}
                        {item.intervalMonths !== null && (
                          <small>{t('archive.repeatMonths', { count: item.intervalMonths })}</small>
                        )}
                        {item.firstDueDate && <small>{displayDate(item.firstDueDate)}</small>}
                        {item.firstDueMiles !== null && (
                          <small>{formatDistance(item.firstDueMiles, car.distanceUnit)}</small>
                        )}
                        {item.sourceNote && (
                          <small>{t('car.source', { source: item.sourceNote })}</small>
                        )}
                      </div>
                      <button
                        disabled={archiveBusy}
                        className="icon-button"
                        aria-label={t('shared.editNamed', { name: item.name })}
                        onClick={() => onEditSchedule(item)}
                      >
                        <Settings2 size={16} />
                      </button>
                      <button
                        disabled={archiveBusy}
                        className="icon-button danger"
                        aria-label={t('shared.deleteNamed', { name: item.name })}
                        onClick={() => onDeleteSchedule(item)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                {carDue.map((due) => (
                  <div className="schedule-row" key={due.schedule.id}>
                    <span className={`status-dot ${due.status}`} />
                    <div className="schedule-main">
                      <strong>{due.schedule.name}</strong>
                      <small>{dueDescription(due)}</small>
                      {due.schedule.sourceNote && (
                        <small>{t('car.source', { source: due.schedule.sourceNote })}</small>
                      )}
                    </div>
                    {due.status === 'later' ? (
                      <span className="sr-only">{t('shared.later')}</span>
                    ) : (
                      <span className={`status-pill ${due.status}`}>
                        {due.status === 'due'
                          ? t('car.due')
                          : due.status === 'upcoming'
                            ? t('shared.comingUp')
                            : due.status === 'setup'
                              ? t('shared.setup')
                              : t('shared.done')}
                      </span>
                    )}
                    <button
                      disabled={archiveBusy}
                      className="icon-button"
                      aria-label={t('shared.editNamed', { name: due.schedule.name })}
                      onClick={() => onEditSchedule(due.schedule)}
                    >
                      <Settings2 size={16} />
                    </button>
                    <button
                      disabled={archiveBusy}
                      className="icon-button danger"
                      aria-label={t('shared.deleteNamed', { name: due.schedule.name })}
                      onClick={() => onDeleteSchedule(due.schedule)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
              {carSchedules.length === 0 && (
                <div className="panel-empty">
                  <ClipboardList size={20} />
                  <div>
                    <strong>{t('car.noTasks')}</strong>
                    <p>{t('car.addTaskHint')}</p>
                  </div>
                </div>
              )}
            </section>
            <section className="panel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">{t('car.history')}</span>
                  <h2>{t('car.latestVisits')}</h2>
                </div>
                <span className="count-badge">{number(carVisits.length)}</span>
              </div>
              {carVisits.length ? (
                <div className="recent-list">
                  {carVisits.slice(0, 6).map((visit) => (
                    <div className="recent-row" key={visit.id}>
                      <span className="service-icon">
                        <Wrench size={18} />
                      </span>
                      <span className="recent-main">
                        <strong>
                          {visit.items.map((item) => item.name).join(', ') ||
                            t('shared.serviceVisit')}
                        </strong>
                        <small>
                          {displayDate(visit.date)} ·{' '}
                          {visit.odometer === null
                            ? '—'
                            : formatDistance(visit.odometer, car?.distanceUnit)}
                        </small>
                      </span>
                      <strong>{money(visit.totalCostCents, visit.currency ?? 'USD')}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="panel-empty">
                  <Wrench size={20} />
                  <div>
                    <strong>{t('car.noVisits')}</strong>
                    <p>{t('car.historyHint')}</p>
                  </div>
                </div>
              )}
              <div className="account-actions">
                <button
                  disabled={archiveBusy}
                  className="text-link"
                  onClick={() => onAddVisit(car.id)}
                >
                  <Plus size={16} />
                  {t('shared.logService')}
                </button>
                <Link className="text-link" href={historyPath(car.id)}>
                  {t('car.viewHistory')}
                  <ArrowRight size={16} />
                </Link>
              </div>
              <button
                disabled={archiveBusy}
                className="text-link danger-text"
                onClick={() => onDeleteCar(car)}
              >
                <Trash2 size={15} />
                {t('car.delete')}
              </button>
            </section>
            <section className="panel tone-fuel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">{t('fuel.eyebrow')}</span>
                  <h2>{t('fuel.recent')}</h2>
                </div>
                <span className="count-badge">{number(carFuel.length)}</span>
              </div>
              <p className="section-hint">
                {economy?.average != null
                  ? `${t('fuel.average')}: ${fuel.economy(economy.average, economy.unit)}`
                  : t('fuel.noEconomy')}
              </p>
              {carFuel.length ? (
                <div className="recent-list">
                  {carFuel.slice(0, 5).map((entry) => (
                    <div className="recent-row" key={entry.id}>
                      <span className="service-icon">
                        <Fuel size={18} />
                      </span>
                      <span className="recent-main">
                        <strong>
                          {fuel.volume(entry)} · {t(`fuel.types.${entry.fuelType}`)}
                          {!entry.isFullTank && ` · ${t('fuel.partial')}`}
                        </strong>
                        <small>
                          {displayDate(entry.date)} ·{' '}
                          {formatDistance(entry.odometer, car.distanceUnit)}
                          {economy?.byEntry.has(entry.id) &&
                            ` · ${fuel.economy(economy.byEntry.get(entry.id), economy.unit)}`}
                        </small>
                      </span>
                      <strong>{fuel.total(entry)}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="panel-empty">
                  <Fuel size={20} />
                  <div>
                    <strong>{t('fuel.empty')}</strong>
                    <p>{t('fuel.firstEntry')}</p>
                  </div>
                </div>
              )}
              <div className="account-actions">
                <button
                  disabled={archiveBusy}
                  className="text-link"
                  onClick={() => onAddFuel(car.id)}
                >
                  <Plus size={16} />
                  {t('fuel.log')}
                </button>
                <Link className="text-link" href={fuelPath(car.id)}>
                  {t('fuel.viewAll')}
                  <ArrowRight size={16} />
                </Link>
              </div>
            </section>
          </div>
        </>
      )}
    </>
  );
}
