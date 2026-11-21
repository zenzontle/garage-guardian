'use client';

import { type DueItem } from '@/lib/maintenance/due';
import { useDisplay } from '@/i18n/use-display';
import { StatusRow } from './status-row';

export function DueRow({
  item,
  href,
  onLog,
}: {
  item: DueItem;
  href?: string;
  /** Opens a new service visit with this task completed. */
  onLog?: () => void;
}) {
  const { dueDescription } = useDisplay();
  return (
    <StatusRow
      name={item.schedule.name}
      detail={`${item.car.name} · ${dueDescription(item)}`}
      status={item.status}
      href={href}
      onLog={onLog}
    />
  );
}
