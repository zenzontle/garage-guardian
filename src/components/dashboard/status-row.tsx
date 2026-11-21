'use client';

import Link from '../interaction/guarded-link';
import { useTranslations } from 'next-intl';
import { ArrowRight, Check } from 'lucide-react';
import { type DueItem } from '@/lib/maintenance/due';
import { type Renewal } from '@/lib/expenses/expenses';

export type Status = DueItem['status'] | Renewal['status'];

export function StatusRow({
  name,
  detail,
  status,
  href,
  onLog,
}: {
  name: string;
  detail: string;
  status: Status;
  href?: string;
  onLog?: () => void;
}) {
  const t = useTranslations();
  const content = (
    <>
      <span className={`status-dot ${status}`} />
      <span className="due-main">
        <strong>{name}</strong>
        <small>{detail}</small>
      </span>
      <span className={`status-pill ${status}`}>
        {status === 'due'
          ? t('shared.dueNow')
          : status === 'upcoming'
            ? t('shared.comingUp')
            : status === 'setup'
              ? t('shared.setup')
              : status === 'completed'
                ? t('shared.done')
                : t('shared.later')}
      </span>
    </>
  );
  const row = href ? (
    <Link className="due-row" href={href}>
      {content}
      <ArrowRight size={16} />
    </Link>
  ) : (
    <div className="due-row">{content}</div>
  );
  if (!onLog) return row;
  // The button sits beside the link: interactive elements cannot nest.
  return (
    <div className="due-item">
      {row}
      <button
        type="button"
        className="button secondary due-log"
        aria-label={t('dashboard.logNamed', { name })}
        onClick={onLog}
      >
        <Check size={16} aria-hidden="true" />
        {t('dashboard.logIt')}
      </button>
    </div>
  );
}
