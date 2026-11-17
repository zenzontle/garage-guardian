'use client';

import { useTranslations } from 'next-intl';
import { CarFront } from 'lucide-react';
import { Skeleton } from '../ui/skeleton';
import { SkeletonRows } from '../ui/skeleton-rows';

/** The selected car's layout, with placeholders until its records load. */
export function CarLoading() {
  const t = useTranslations();
  return (
    <>
      <div className="car-switcher" aria-hidden="true">
        <Skeleton className="skeleton-tab" width="9rem" />
        <Skeleton className="skeleton-tab" width="7rem" />
      </div>
      <div className="car-header panel">
        <div className="car-header-icon" aria-hidden="true">
          <CarFront size={30} />
        </div>
        <div className="car-header-copy skeleton-lines">
          <Skeleton className="skeleton-small" width="8rem" />
          <Skeleton className="skeleton-heading" width="12rem" />
          <Skeleton width="16rem" />
        </div>
      </div>
      <div className="car-content-grid">
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">{t('car.servicePlan')}</span>
              <h2>{t('car.maintenanceSchedule')}</h2>
            </div>
          </div>
          <p className="section-hint">{t('car.scheduleHint')}</p>
          <SkeletonRows count={4} />
        </section>
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">{t('car.history')}</span>
              <h2>{t('car.latestVisits')}</h2>
            </div>
          </div>
          <SkeletonRows count={3} />
        </section>
        <section className="panel tone-fuel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">{t('fuel.eyebrow')}</span>
              <h2>{t('fuel.recent')}</h2>
            </div>
          </div>
          <SkeletonRows count={3} />
        </section>
      </div>
    </>
  );
}
