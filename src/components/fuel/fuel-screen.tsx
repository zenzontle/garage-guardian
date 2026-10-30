'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FuelPage } from './fuel-page';
import { useGarage } from '../garage/garage-provider';
import { useInteractions } from '../interaction/interaction-provider';
import { useDisplay } from '@/i18n/use-display';
import { fuelPath } from '@/lib/navigation/garage-routes';

export function FuelScreen() {
  const t = useTranslations();
  const interactions = useInteractions();
  const display = useDisplay();
  const router = useRouter();
  const search = useSearchParams();
  const { snapshot, fuelEntries, repository, setModal, perform } = useGarage();
  const requested = search.get('car') ?? '';
  // An unknown or deleted vehicle in the link shows every fill-up instead of an empty list.
  const carId = snapshot.cars.some((car) => car.id === requested) ? requested : '';
  return (
    <FuelPage
      cars={snapshot.cars}
      fuelEntries={fuelEntries}
      repository={repository!}
      carId={carId}
      onCarChange={(id) => router.replace(fuelPath(id))}
      onAdd={() => setModal({ kind: 'fuel', carId: carId || undefined })}
      onEdit={(item) => setModal({ kind: 'fuel', item })}
      onDelete={(entry) =>
        interactions?.confirmDelete({
          title: t('interactions.deleteTitle', {
            name: t('interactions.fuelName', {
              vehicle:
                snapshot.cars.find((car) => car.id === entry.carId)?.name ?? t('fuel.unknown'),
              date: display.displayDate(entry.date),
            }),
          }),
          description: t('interactions.deleteFuel'),
          success: 'interactions.fuelDeleted',
          onDelete: async () => {
            await perform(() => repository!.deleteFuelEntry(entry));
          },
        })
      }
    />
  );
}
