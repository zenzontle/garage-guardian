'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { distanceAbbreviation, type DistanceUnit } from '@/lib/model';
import type { DueItem } from '@/lib/due';

export function useDisplay() {
  const format = useFormatter();
  const t = useTranslations('due');
  const number = (value: number) => format.number(value);
  const money = (cents: number) => format.number(cents / 100, { style: 'currency', currency: 'USD' });
  const displayDate = (iso: string) => format.dateTime(new Date(`${iso}T00:00:00Z`), { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const formatDistance = (value: number, unit?: DistanceUnit) => `${number(value)} ${distanceAbbreviation(unit)}`;
  function dueDescription(item: DueItem) {
    if (item.status === 'setup') return t('setup');
    if (item.status === 'completed') return t('completed');
    if (item.dueDate && item.dueMiles !== null) return t('combined', { date: displayDate(item.dueDate), distance: formatDistance(item.dueMiles, item.car.distanceUnit) });
    if (item.dueDate) return t('date', { date: displayDate(item.dueDate) });
    if (item.dueMiles !== null) return t('distance', { distance: formatDistance(item.dueMiles, item.car.distanceUnit) });
    return '';
  }
  const month = (iso: string) => format.dateTime(new Date(`${iso}-01T00:00:00Z`), { month: 'short', year: 'numeric', timeZone: 'UTC' });
  return { number, money, displayDate, formatDistance, dueDescription, month };
}
