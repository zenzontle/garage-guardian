'use client';

import { type ReactNode } from 'react';

export function Stat({
  icon,
  label,
  value,
  detail,
  accent = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}) {
  return (
    <div className={`stat-card ${accent ? 'alert' : ''}`}>
      <div className="stat-top">
        <span className="stat-icon">{icon}</span>
        <span className="stat-label">{label}</span>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
