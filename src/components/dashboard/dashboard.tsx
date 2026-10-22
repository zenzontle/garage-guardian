'use client';

import Link from '../interaction/guarded-link';
import { carPath } from '@/lib/navigation/garage-routes';
import { useTranslations } from 'next-intl';
import {
  ArrowRight,
  CalendarDays,
  CarFront,
  Check,
  CircleAlert,
  Plus,
  ReceiptText,
  Settings2,
  Wrench,
} from 'lucide-react';
import { latestOdometer, type DueItem } from '@/lib/maintenance/due';
import { type Car, type Visit } from '@/lib/garage/model';
import { useDisplay } from '@/i18n/use-display';
import { PageHeading } from '../ui/page-heading';
import { Stat } from '../ui/stat';
import { DueRow } from './due-row';
import { reportTotals } from '@/lib/reports/reports';
import type { Currency } from '@/lib/currency/currency';

export function Dashboard({
  cars,
  visits,
  allDue,
  onAddCar,
  onAddVisit,
  homeCurrency = 'USD',
}: {
  cars: Car[];
  visits: Visit[];
  allDue: DueItem[];
  onAddCar: () => void;
  onAddVisit: () => void;
  homeCurrency?: Currency;
}) {
  const t = useTranslations();
  const { number, money, displayDate, formatDistance } = useDisplay();
  const due = allDue.filter((item) => item.status === 'due');
  const upcoming = allDue.filter((item) => item.status === 'upcoming');
  const setup = allDue.filter((item) => item.status === 'setup');
  const spending = reportTotals(
    visits.filter((visit) => visit.date.startsWith(String(new Date().getFullYear()))),
    cars,
    homeCurrency,
  );
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
          <div className="empty-illustration" aria-hidden="true">
            <CarFront size={55} strokeWidth={1.5} />
          </div>
          <h2>{t('dashboard.emptyTitle')}</h2>
          <p>{t('dashboard.emptyDescription')}</p>
          <button className="button primary" onClick={onAddCar}>
            <Plus size={18} />
            {t('shared.addCar')}
          </button>
          <ul className="garage-benefits">
            <li>
              <Wrench size={18} aria-hidden="true" />
              {t('dashboard.benefitHistory')}
            </li>
            <li>
              <CalendarDays size={18} aria-hidden="true" />
              {t('dashboard.benefitSchedule')}
            </li>
            <li>
              <ReceiptText size={18} aria-hidden="true" />
              {t('dashboard.benefitSpending')}
            </li>
          </ul>
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
              tone="orange"
            />
            <Stat
              icon={<CalendarDays size={20} />}
              label={t('shared.comingUp')}
              value={number(upcoming.length)}
              detail={t('dashboard.reminderWindows')}
              tone="yellow"
            />
            <Stat
              icon={<ReceiptText size={20} />}
              label={t('dashboard.yearSpend')}
              value={money(spending.totalCents, homeCurrency)}
              detail={
                spending.pendingCount
                  ? t('currency.incomplete', { count: spending.pendingCount })
                  : t('dashboard.allVehicles')
              }
              tone="muted"
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
                    <DueRow key={item.schedule.id} item={item} href={carPath(item.car.id)} />
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
              {setup.length > 0 && (
                <>
                  <div className="setup-note">
                    <Settings2 size={16} />
                    <span>{t('dashboard.setupNote', { count: setup.length })}</span>
                  </div>
                  <div className="due-list">
                    {setup.map((item) => (
                      <DueRow key={item.schedule.id} item={item} href={carPath(item.car.id)} />
                    ))}
                  </div>
                </>
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
                    <Link className="vehicle-row" key={car.id} href={carPath(car.id)}>
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
                    </Link>
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
              <Link className="text-link" href="/history">
                {t('dashboard.viewAll')}
                <ArrowRight size={16} />
              </Link>
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
                    <strong>{money(visit.totalCostCents, visit.currency ?? 'USD')}</strong>
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
