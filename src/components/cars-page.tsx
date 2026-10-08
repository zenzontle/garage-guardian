'use client';

import Link from 'next/link';
import { carPath } from '@/lib/garage-routes';
import { useTranslations } from 'next-intl';
import { CarFront, ClipboardList, Gauge, Plus, Settings2, Trash2, Wrench } from 'lucide-react';
import { latestOdometer, type DueItem } from '@/lib/due';
import { type Car, type ScheduleItem, type Visit } from '@/lib/model';
import { useDisplay } from '@/i18n/use-display';
import { PageHeading } from './page-heading';
import { EmptyPanel } from './empty-panel';

export function CarsPage({
  cars,
  visits,
  allDue,
  selectedCar,
  onAdd,
  onEdit,
  onAddSchedule,
  onEditSchedule,
  onAddVisit,
  onDeleteCar,
  onDeleteSchedule,
}: {
  cars: Car[];
  visits: Visit[];
  allDue: DueItem[];
  selectedCar: Car | null;
  onAdd: () => void;
  onEdit: (car: Car) => void;
  onAddSchedule: (carId: string) => void;
  onEditSchedule: (item: ScheduleItem) => void;
  onAddVisit: (carId: string) => void;
  onDeleteCar: (car: Car) => void;
  onDeleteSchedule: (item: ScheduleItem) => void;
}) {
  const t = useTranslations();
  const { number, money, displayDate, formatDistance, dueDescription } = useDisplay();
  const car = selectedCar;
  const carDue = car ? allDue.filter((item) => item.car.id === car.id) : [];
  const carVisits = car ? visits.filter((visit) => visit.carId === car.id) : [];
  return (
    <>
      <PageHeading
        eyebrow={t('dashboard.yourVehicles')}
        title={t('navigation.cars')}
        description={t('car.description')}
        action={
          <button className="button primary" onClick={onAdd}>
            <Plus size={18} />
            {t('shared.addCar')}
          </button>
        }
      />
      {!car ? (
        <EmptyPanel
          icon={<CarFront size={25} />}
          title={t('car.emptyTitle')}
          description={t('car.emptyDescription')}
          action={
            <button className="button primary" onClick={onAdd}>
              {t('shared.addCar')}
            </button>
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
              <p>
                <Gauge size={16} /> {formatDistance(latestOdometer(car, visits), car.distanceUnit)}{' '}
                {t('car.currentOdometer')}
                {car.vin && ` · VIN ${car.vin}`}
              </p>
              {car.plate && <p className="car-plate">{t('car.plate', { plate: car.plate })}</p>}
            </div>
            <div className="car-header-actions">
              <button
                className="button secondary"
                onClick={() => onEdit({ ...car, odometer: latestOdometer(car, visits) })}
              >
                <Settings2 size={16} />
                {t('car.edit')}
              </button>
              <button className="button primary" onClick={() => onAddVisit(car.id)}>
                <Plus size={17} />
                {t('shared.logService')}
              </button>
            </div>
          </div>
          <div className="car-content-grid">
            <section className="panel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">{t('car.servicePlan')}</span>
                  <h2>{t('car.maintenanceSchedule')}</h2>
                </div>
                <button className="text-link" onClick={() => onAddSchedule(car.id)}>
                  <Plus size={16} />
                  {t('car.addTask')}
                </button>
              </div>
              <p className="section-hint">{t('car.scheduleHint')}</p>
              <div className="schedule-list">
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
                    <span className={`status-pill ${due.status}`}>
                      {due.status === 'due'
                        ? t('car.due')
                        : due.status === 'upcoming'
                          ? t('car.soon')
                          : due.status === 'setup'
                            ? t('shared.setup')
                            : due.status === 'completed'
                              ? t('shared.done')
                              : t('shared.later')}
                    </span>
                    <button
                      className="icon-button"
                      aria-label={t('shared.editNamed', { name: due.schedule.name })}
                      onClick={() => onEditSchedule(due.schedule)}
                    >
                      <Settings2 size={16} />
                    </button>
                    <button
                      className="icon-button danger"
                      aria-label={t('shared.deleteNamed', { name: due.schedule.name })}
                      onClick={() => onDeleteSchedule(due.schedule)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
              {carDue.length === 0 && (
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
                          {formatDistance(visit.odometer, car?.distanceUnit)}
                        </small>
                      </span>
                      <strong>{money(visit.totalCostCents)}</strong>
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
              <button className="text-link danger-text" onClick={() => onDeleteCar(car)}>
                <Trash2 size={15} />
                {t('car.delete')}
              </button>
            </section>
          </div>
        </>
      )}
    </>
  );
}
