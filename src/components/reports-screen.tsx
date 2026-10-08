'use client';

import { ReportsPage } from './reports-page';
import { useGarage } from './garage-provider';

export function ReportsScreen() {
  const { snapshot, visits } = useGarage();
  return <ReportsPage cars={snapshot.cars} visits={visits} />;
}
