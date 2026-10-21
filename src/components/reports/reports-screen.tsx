'use client';

import { ReportsPage } from './reports-page';
import { useGarage } from '../garage/garage-provider';

export function ReportsScreen() {
  const { snapshot, visits, homeCurrency } = useGarage();
  return <ReportsPage cars={snapshot.cars} visits={visits} homeCurrency={homeCurrency} />;
}
