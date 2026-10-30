'use client';

import { Dashboard } from './dashboard';
import { useGarage } from '../garage/garage-provider';

export function DashboardScreen() {
  const { snapshot, visits, fuelEntries, allDue, setModal, homeCurrency } = useGarage();
  return (
    <Dashboard
      cars={snapshot.cars}
      visits={visits}
      fuelEntries={fuelEntries}
      homeCurrency={homeCurrency}
      allDue={allDue}
      onAddCar={() => setModal({ kind: 'car' })}
      onAddVisit={() => setModal({ kind: 'visit' })}
      onAddFuel={() => setModal({ kind: 'fuel' })}
    />
  );
}
