'use client';

import Link from '../interaction/guarded-link';
import { carPath, costsPath, fuelPath } from '@/lib/navigation/garage-routes';
import { useTranslations } from 'next-intl';
import {
  ArrowRight,
  CalendarDays,
  CarFront,
  Check,
  CircleAlert,
  Fuel,
  Plus,
  ReceiptText,
  Settings2,
  Wrench,
} from 'lucide-react';
import { latestOdometer, type DueItem } from '@/lib/maintenance/due';
import { type Car, type Expense, type FuelEntry, type Visit } from '@/lib/garage/model';
import type { Renewal } from '@/lib/expenses/expenses';
import { useDisplay } from '@/i18n/use-display';
import { PageHeading } from '../ui/page-heading';
import { Stat } from '../ui/stat';
import { Skeleton } from '../ui/skeleton';
import { SkeletonRows } from '../ui/skeleton-rows';
import { DueRow } from './due-row';
import { RenewalRow } from './renewal-row';
import { useFuelDisplay } from '../fuel/use-fuel-display';
import { reportTotals } from '@/lib/reports/reports';
import type { Currency } from '@/lib/currency/currency';

export function Dashboard({
  cars,
  visits,
  fuelEntries = [],
  expenses = [],
  allDue,
  renewals = [],
  onAddCar,
  onAddVisit,
  onAddFuel,
  onLogTask,
  onLogRenewal,
  homeCurrency = 'USD',
  loading = false,
}: {
  /** Renders the layout with placeholders where records go. */
  loading?: boolean;
  cars: Car[];
  visits: Visit[];
  fuelEntries?: FuelEntry[];
  expenses?: Expense[];
  allDue: DueItem[];
  renewals?: Renewal[];
  onAddCar: () => void;
  onAddVisit: () => void;
  onAddFuel?: () => void;
  onLogTask?: (item: DueItem) => void;
  onLogRenewal?: (renewal: Renewal) => void;
  homeCurrency?: Currency;
}) {
  const t = useTranslations();
  const { number, money, displayDate, formatDistance } = useDisplay();
  const fuel = useFuelDisplay();
  const activeCars = cars.filter((car) => !car.isArchived);
  const due = allDue.filter((item) => item.status === 'due');
  const upcoming = allDue.filter((item) => item.status === 'upcoming');
  const setup = allDue.filter((item) => item.status === 'setup');
  const dueRenewals = renewals.filter((renewal) => renewal.status === 'due');
  const upcomingRenewals = renewals.filter((renewal) => renewal.status === 'upcoming');
  const dueCount = due.length + dueRenewals.length;
  const upcomingCount = upcoming.length + upcomingRenewals.length;
  const thisYear = (record: { date: string }) =>
    record.date.startsWith(String(new Date().getFullYear()));
  const spending = reportTotals(
    visits.filter(thisYear),
    cars,
    homeCurrency,
    fuelEntries.filter(thisYear),
    expenses.filter(thisYear),
  );
  return (
    <>
      <PageHeading
        eyebrow={t('dashboard.overview')}
        title={t('dashboard.title')}
        description={t('dashboard.description')}
        action={
          loading ? (
            <Skeleton className="skeleton-button" width="9rem" />
          ) : (
            <div className="account-actions">
              {activeCars.length > 0 && onAddFuel && (
                <button className="button primary tone-fuel" onClick={onAddFuel}>
                  <Fuel size={18} />
                  {t('dashboard.logFuel')}
                </button>
              )}
              <button
                className="button primary"
                onClick={activeCars.length ? onAddVisit : onAddCar}
              >
                <Plus size={18} />
                {activeCars.length ? t('shared.logService') : t('dashboard.firstCar')}
              </button>
            </div>
          )
        }
      />
      {cars.length === 0 && !loading ? (
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
              value={number(activeCars.length)}
              detail={t('app.inGarage')}
              tone="vehicle"
              loading={loading}
            />
            <Stat
              icon={<CircleAlert size={20} />}
              label={t('shared.dueNow')}
              value={number(dueCount)}
              detail={t('dashboard.attentionItems', { count: dueCount })}
              tone="orange"
              loading={loading}
            />
            <Stat
              icon={<CalendarDays size={20} />}
              label={t('shared.comingUp')}
              value={number(upcomingCount)}
              detail={t('dashboard.reminderWindows')}
              tone="yellow"
              loading={loading}
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
              tone="spend"
              loading={loading}
            />
          </div>
          <div className="dashboard-grid">
            <section className="panel attention-panel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">{t('dashboard.maintenance')}</span>
                  <h2>{t('dashboard.attention')}</h2>
                </div>
                {!loading && (
                  <span className="count-badge">{number(dueCount + upcomingCount)}</span>
                )}
              </div>
              {loading ? (
                <SkeletonRows count={4} />
              ) : dueCount + upcomingCount ? (
                <div className="due-list">
                  {/* Everything due comes before anything coming up, tasks and renewals alike. */}
                  {[
                    ...due.map((item) => ({ item })),
                    ...dueRenewals.map((renewal) => ({ renewal })),
                    ...upcoming.map((item) => ({ item })),
                    ...upcomingRenewals.map((renewal) => ({ renewal })),
                  ]
                    .slice(0, 6)
                    .map((row) =>
                      'item' in row ? (
                        <DueRow
                          key={row.item.schedule.id}
                          item={row.item}
                          href={carPath(row.item.car.id)}
                          onLog={onLogTask && (() => onLogTask(row.item))}
                        />
                      ) : (
                        <RenewalRow
                          key={row.renewal.expense.id}
                          renewal={row.renewal}
                          href={costsPath(row.renewal.car.id)}
                          onLog={onLogRenewal && (() => onLogRenewal(row.renewal))}
                        />
                      ),
                    )}
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
              {loading && <SkeletonRows count={3} />}
              <div className="vehicle-list">
                {activeCars.length === 0 && !loading && (
                  <div className="panel-empty">
                    <CarFront size={22} />
                    <div>
                      <strong>{t('archive.activeEmptyTitle')}</strong>
                      <p>{t('archive.activeEmptyDescription')}</p>
                      <div className="account-actions">
                        <button className="button primary" onClick={onAddCar}>
                          {t('shared.addCar')}
                        </button>
                        <Link className="button secondary" href="/cars?view=archived">
                          {t('archive.viewArchived')}
                        </Link>
                      </div>
                    </div>
                  </div>
                )}
                {activeCars.map((car) => {
                  const count =
                    due.filter((item) => item.car.id === car.id).length +
                    dueRenewals.filter((renewal) => renewal.car.id === car.id).length;
                  return (
                    <Link className="vehicle-row" key={car.id} href={carPath(car.id)}>
                      <span className="vehicle-icon">
                        <CarFront size={22} />
                      </span>
                      <span>
                        <strong>{car.name}</strong>
                        <small>
                          {car.year} {car.make} {car.model} ·{' '}
                          {formatDistance(
                            latestOdometer(car, visits, fuelEntries),
                            car.distanceUnit,
                          )}
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
              {!loading && (
                <button className="text-link" onClick={onAddCar}>
                  <Plus size={16} /> {t('dashboard.addAnother')}
                </button>
              )}
            </section>
          </div>
          <div className="recent-grid">
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
              {loading ? (
                <SkeletonRows count={3} />
              ) : visits.length ? (
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
                          {cars.find((car) => car.id === visit.carId)?.isArchived &&
                            `${t('archive.archived')} · `}
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
            <section className="panel recent-panel tone-fuel">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">{t('fuel.eyebrow')}</span>
                  <h2>{t('fuel.recent')}</h2>
                </div>
                <Link className="text-link" href={fuelPath()}>
                  {t('fuel.viewAll')}
                  <ArrowRight size={16} />
                </Link>
              </div>
              {loading ? (
                <SkeletonRows count={3} />
              ) : fuelEntries.length ? (
                <div className="recent-list">
                  {fuelEntries.slice(0, 5).map((entry) => {
                    const car = cars.find((item) => item.id === entry.carId);
                    return (
                      <div className="recent-row" key={entry.id}>
                        <span className="service-icon">
                          <Fuel size={18} />
                        </span>
                        <span className="recent-main">
                          <strong>
                            {fuel.volume(entry)} · {t(`fuel.types.${entry.fuelType}`)}
                          </strong>
                          <small>
                            {car?.name} · {car?.isArchived && `${t('archive.archived')} · `}
                            {displayDate(entry.date)}
                          </small>
                        </span>
                        <strong>{fuel.total(entry)}</strong>
                      </div>
                    );
                  })}
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
            </section>
          </div>
        </>
      )}
    </>
  );
}
