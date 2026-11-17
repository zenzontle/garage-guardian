'use client';

import { type ReactNode } from 'react';
import { Skeleton } from './skeleton';

export function Stat({
  icon,
  label,
  value,
  detail,
  tone = 'blue',
  loading = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone?: 'blue' | 'orange' | 'yellow' | 'muted' | 'fuel' | 'vehicle' | 'spend';
  /** Shows placeholders for the value and detail while records load. */
  loading?: boolean;
}) {
  if (loading)
    return (
      <div className={`stat-card stat-${tone}`}>
        <div className="stat-top">
          <span className="stat-icon" aria-hidden="true">
            {icon}
          </span>
          <span className="stat-label">{label}</span>
        </div>
        <Skeleton className="skeleton-value" width="40%" />
        <Skeleton className="skeleton-small" width="65%" />
      </div>
    );
  return (
    <div className={`stat-card stat-${tone}`}>
      <div className="stat-top">
        <span className="stat-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="stat-label">{label}</span>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
