'use client';

import { Dashboard } from './dashboard';
import { useGarage } from './garage-provider';

export function DashboardScreen() {
  const { snapshot, visits, allDue, setModal } = useGarage();
  return (
    <Dashboard
      cars={snapshot.cars}
      visits={visits}
      allDue={allDue}
      onAddCar={() => setModal({ kind: 'car' })}
      onAddVisit={() => setModal({ kind: 'visit' })}
    />
  );
}
