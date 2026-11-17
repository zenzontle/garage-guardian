'use client';

import { useTranslations } from 'next-intl';
import { CURRENCIES } from '@/lib/currency/currency';
import type { Car } from '@/lib/garage/model';

/** `<option>`s for a vehicle `<select>`; archived vehicles are labeled as such. */
export function CarOptions({ cars }: { cars: Car[] }) {
  const t = useTranslations();
  return cars.map((car) => (
    <option key={car.id} value={car.id}>
      {car.name}
      {car.isArchived && ` (${t('archive.archived')})`}
    </option>
  ));
}

/** `<option>`s for every supported currency, as "CODE — name". */
export function CurrencyOptions() {
  const t = useTranslations();
  return CURRENCIES.map((code) => (
    <option key={code} value={code}>
      {code} — {t(`currency.${code}`)}
    </option>
  ));
}
