'use client';

import { useTranslations } from 'next-intl';
import {
  ArrowRight,
  CalendarDays,
  CarFront,
  Check,
  CircleAlert,
  DollarSign,
  Plus,
  Settings2,
  Wrench,
} from 'lucide-react';
import { latestOdometer, type DueItem } from '@/lib/due';
import { type Car, type Visit } from '@/lib/model';
import { useDisplay } from '@/i18n/use-display';
import { PageHeading } from './page-heading';
import { Stat } from './stat';
import { DueRow } from './due-row';

export function Dashboard({
  cars,
  visits,
  allDue,
  onAddCar,
  onAddVisit,
  onViewCar,
  onViewAll,
}: {
  cars: Car[];
  visits: Visit[];
  allDue: DueItem[];
  onAddCar: () => void;
  onAddVisit: () => void;
  onViewCar: (id: string) => void;
  onViewAll: () => void;
}) {
  const t = useTranslations();
  const { number, money, displayDate, formatDistance } = useDisplay();
  const due = allDue.filter((item) => item.status === 'due');
  const upcoming = allDue.filter((item) => item.status === 'upcoming');
  const spendThisYear = visits
    .filter((visit) => visit.date.startsWith(String(new Date().getFullYear())))
    .reduce((sum, visit) => sum + visit.totalCostCents, 0);
  return (
    <>
      <PageHeading
        eyebrow={t('dashboard.overview')}
        title={t('dashboard.title')}
        description={t('dashboard.description')}
        action={
          <button className="button primary" onClick={cars.length ? onAddVisit : onAddCar}>
            <Plus size={18} />
            {cars.length ? t('shared.logService') : t('dashboard.firstCar')}
          </button>
        }
      />
      {cars.length === 0 ? (
        <div className="empty-hero">
          <div className="empty-illustration">
            <CarFront size={55} strokeWidth={1.5} />
          </div>
          <h2>{t('dashboard.emptyTitle')}</h2>
          <p>{t('dashboard.emptyDescription')}</p>
          <button className="button primary" onClick={onAddCar}>
            <Plus size={18} />
            {t('shared.addCar')}
          </button>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <Stat
              icon={<CarFront size={20} />}
              label={t('dashboard.vehicles')}
              value={number(cars.length)}
              detail={t('app.inGarage')}
            />
            <Stat
              icon={<CircleAlert size={20} />}
              label={t('shared.dueNow')}
              value={number(due.length)}
              detail={t('dashboard.attentionItems', { count: due.length })}
              accent={due.length > 0}
            />
            <Stat
              icon={<CalendarDays size={20} />}
              label={t('shared.comingUp')}
              value={number(upcoming.length)}
              detail={t('dashboard.reminderWindows')}
            />
            <Stat
              icon={<DollarSign size={20} />}
              label={t('dashboard.yearSpend')}
              value={money(spendThisYear)}
              detail={t('dashboard.allVehicles')}
            />
          </div>
          <div className="dashboard-grid">
            <section className="panel attention-panel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">{t('dashboard.maintenance')}</span>
                  <h2>{t('dashboard.attention')}</h2>
                </div>
                <span className="count-badge">{number(due.length + upcoming.length)}</span>
              </div>
              {due.length + upcoming.length ? (
                <div className="due-list">
                  {[...due, ...upcoming].slice(0, 6).map((item) => (
                    <DueRow
                      key={item.schedule.id}
                      item={item}
                      onClick={() => onViewCar(item.car.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="panel-empty">
                  <Check size={21} />
                  <div>
                    <strong>{t('dashboard.caughtUp')}</strong>
                    <p>{t('dashboard.noDue')}</p>
                  </div>
                </div>
              )}
              {allDue.some((item) => item.status === 'setup') && (
                <div className="setup-note">
                  <Settings2 size={16} />
                  {t('dashboard.setupNote')}
                </div>
              )}
            </section>
            <section className="panel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">{t('dashboard.yourVehicles')}</span>
                  <h2>{t('dashboard.inGarage')}</h2>
                </div>
              </div>
              <div className="vehicle-list">
                {cars.map((car) => {
                  const count = allDue.filter(
                    (item) => item.car.id === car.id && item.status === 'due',
                  ).length;
                  return (
                    <button className="vehicle-row" key={car.id} onClick={() => onViewCar(car.id)}>
                      <span className="vehicle-icon">
                        <CarFront size={22} />
                      </span>
                      <span>
                        <strong>{car.name}</strong>
                        <small>
                          {car.year} {car.make} {car.model} ·{' '}
                          {formatDistance(latestOdometer(car, visits), car.distanceUnit)}
                        </small>
                      </span>
                      {count > 0 && (
                        <span className="tiny-alert">{t('dashboard.dueCount', { count })}</span>
                      )}
                      <ArrowRight size={17} />
                    </button>
                  );
                })}
              </div>
              <button className="text-link" onClick={onAddCar}>
                <Plus size={16} /> {t('dashboard.addAnother')}
              </button>
            </section>
          </div>
          <section className="panel recent-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">{t('dashboard.activity')}</span>
                <h2>{t('dashboard.recent')}</h2>
              </div>
              <button className="text-link" onClick={onViewAll}>
                {t('dashboard.viewAll')}
                <ArrowRight size={16} />
              </button>
            </div>
            {visits.length ? (
              <div className="recent-list">
                {visits.slice(0, 5).map((visit) => (
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
                        {cars.find((car) => car.id === visit.carId)?.name} ·{' '}
                        {displayDate(visit.date)}
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
                  <strong>{t('dashboard.noVisits')}</strong>
                  <p>{t('dashboard.historyPlaceholder')}</p>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
