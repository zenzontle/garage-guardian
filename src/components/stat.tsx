'use client';

import { type ReactNode } from 'react';

export function Stat({
  icon,
  label,
  value,
  detail,
  tone = 'blue',
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone?: 'blue' | 'orange' | 'yellow' | 'muted';
}) {
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
