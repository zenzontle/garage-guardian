'use client';

import { Dashboard } from './dashboard';
import { useGarage } from '../garage/garage-provider';

export function DashboardScreen() {
  const {
    snapshot,
    visits,
    fuelEntries,
    expenses,
    allDue,
    renewals,
    setModal,
    homeCurrency,
    loading,
  } = useGarage();
  return (
    <Dashboard
      loading={loading}
      cars={snapshot.cars}
      visits={visits}
      fuelEntries={fuelEntries}
      expenses={expenses}
      renewals={renewals}
      homeCurrency={homeCurrency}
      allDue={allDue}
      onAddCar={() => setModal({ kind: 'car' })}
      onAddVisit={() => setModal({ kind: 'visit' })}
      onAddFuel={() => setModal({ kind: 'fuel' })}
      onLogTask={(item) =>
        setModal({ kind: 'visit', carId: item.car.id, scheduleId: item.schedule.id })
      }
      onLogRenewal={({ expense }) => setModal({ kind: 'expense', next: expense })}
    />
  );
}
