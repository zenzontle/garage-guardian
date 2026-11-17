'use client';

import { ReportsPage } from './reports-page';
import { useGarage } from '../garage/garage-provider';

export function ReportsScreen() {
  const { snapshot, visits, homeCurrency, loading } = useGarage();
  return (
    <ReportsPage
      loading={loading}
      cars={snapshot.cars}
      visits={visits}
      homeCurrency={homeCurrency}
    />
  );
}
