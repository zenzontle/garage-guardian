'use client';

import { Dashboard } from './dashboard';
import { useGarage } from '../garage/garage-provider';

export function DashboardScreen() {
  const { snapshot, visits, allDue, setModal, homeCurrency } = useGarage();
  return (
    <Dashboard
      cars={snapshot.cars}
      visits={visits}
      homeCurrency={homeCurrency}
      allDue={allDue}
      onAddCar={() => setModal({ kind: 'car' })}
      onAddVisit={() => setModal({ kind: 'visit' })}
    />
  );
}
