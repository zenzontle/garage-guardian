'use client';

import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import type { Page } from './garage-navigation';

const bar = (className = '', width?: CSSProperties['width']) => (
  <span className={`skeleton ${className}`} style={width ? { width } : undefined} />
);

const panel = (rows: number) => (
  <section className="panel recent-panel">
    <div className="section-heading">
      <div className="skeleton-lines">
        {bar('skeleton-small', '5rem')}
        {bar('skeleton-heading', '10rem')}
      </div>
    </div>
    <div className="recent-list">
      {Array.from({ length: rows }, (_, index) => (
        <div className="recent-row" key={index}>
          {bar('skeleton-icon')}
          <span className="recent-main skeleton-lines">
            {bar('', `${60 - ((index * 13) % 25)}%`)}
            {bar('skeleton-small', `${38 - ((index * 7) % 15)}%`)}
          </span>
        </div>
      ))}
    </div>
  </section>
);

/** Placeholder for the current page's content while the garage records load. */
export function GarageSkeleton({ page }: { page: Page }) {
  const t = useTranslations();
  return (
    <div className="garage-skeleton" aria-busy="true">
      <p className="sr-only" role="status">
        {t('app.loading')}
      </p>
      <div aria-hidden="true">
        <div className="page-heading">
          <div className="skeleton-lines">
            {bar('skeleton-small', '6rem')}
            {bar('skeleton-title', '16rem')}
            {bar('', '28rem')}
          </div>
        </div>
        {page === 'dashboard' ? (
          <>
            <div className="stat-grid">
              {[0, 1, 2, 3].map((index) => (
                <div className="stat-card" key={index}>
                  <div className="stat-top">
                    {bar('skeleton-icon')}
                    {bar('', '45%')}
                  </div>
                  {bar('skeleton-value', '40%')}
                  {bar('skeleton-small', '65%')}
                </div>
              ))}
            </div>
            <div className="dashboard-grid">
              {panel(4)}
              {panel(3)}
            </div>
            <div className="recent-grid">
              {panel(3)}
              {panel(3)}
            </div>
          </>
        ) : (
          panel(5)
        )}
      </div>
    </div>
  );
}
