'use client';

import { ReportsPage } from './reports-page';
import { useGarage } from '../garage/garage-provider';

export function ReportsScreen() {
  const { snapshot, visits, fuelEntries, expenses, homeCurrency, loading } = useGarage();
  return (
    <ReportsPage
      loading={loading}
      cars={snapshot.cars}
      visits={visits}
      fuelEntries={fuelEntries}
      expenses={expenses}
      homeCurrency={homeCurrency}
    />
  );
}
