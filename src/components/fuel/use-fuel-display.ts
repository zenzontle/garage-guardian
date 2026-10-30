'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { FuelEntry } from '@/lib/garage/model';
import type { EconomyUnit } from '@/lib/fuel/economy';
import { useDisplay } from '@/i18n/use-display';

export function useFuelDisplay() {
  const t = useTranslations();
  const format = useFormatter();
  const { money } = useDisplay();
  const volume = (entry: Pick<FuelEntry, 'volumeMilli' | 'volumeUnit'>) =>
    `${format.number(entry.volumeMilli / 1000, { maximumFractionDigits: 3 })} ${t(`units.${entry.volumeUnit}Short`)}`;
  // Pump prices carry a third decimal, e.g. 3.459 per gallon.
  const unitPrice = (entry: Pick<FuelEntry, 'unitPriceMilli' | 'volumeUnit' | 'currency'>) =>
    t('fuel.perUnit', {
      price: format.number(entry.unitPriceMilli / 1000, {
        style: 'currency',
        currency: entry.currency,
        currencyDisplay: 'code',
        minimumFractionDigits: 2,
        maximumFractionDigits: 3,
      }),
      unit: t(`units.${entry.volumeUnit}Short`),
    });
  const total = (entry: Pick<FuelEntry, 'totalCostCents' | 'currency'>) =>
    money(entry.totalCostCents, entry.currency);
  const economy = (value: number | null | undefined, unit: EconomyUnit) =>
    value === null || value === undefined
      ? '—'
      : t(`fuel.${unit}`, {
          value: format.number(value, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
        });
  return { volume, unitPrice, total, economy };
}
