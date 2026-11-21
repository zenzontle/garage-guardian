'use client';

import { useTranslations } from 'next-intl';
import { type Renewal } from '@/lib/expenses/expenses';
import { useDisplay } from '@/i18n/use-display';
import { StatusRow } from './status-row';

export function RenewalRow({
  renewal,
  href,
  onLog,
}: {
  renewal: Renewal;
  href?: string;
  /** Opens a new cost for the same vehicle and category. */
  onLog?: () => void;
}) {
  const t = useTranslations();
  const { displayDate } = useDisplay();
  const date = displayDate(renewal.expense.renewsOn!);
  return (
    <StatusRow
      name={t('expenses.renewalName', {
        category: t(`expenses.categories.${renewal.expense.category}`),
      })}
      detail={`${renewal.car.name} · ${t(
        renewal.status === 'due' ? 'expenses.renewalDue' : 'expenses.renewsDate',
        { date },
      )}`}
      status={renewal.status}
      href={href}
      onLog={onLog}
    />
  );
}
