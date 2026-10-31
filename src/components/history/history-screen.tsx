'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { HistoryPage } from './history-page';
import { useGarage } from '../garage/garage-provider';
import { useInteractions } from '../interaction/interaction-provider';
import { useDisplay } from '@/i18n/use-display';
import { historyPath } from '@/lib/navigation/garage-routes';

export function HistoryScreen() {
  const t = useTranslations();
  const interactions = useInteractions();
  const display = useDisplay();
  const router = useRouter();
  const search = useSearchParams();
  const { snapshot, visits, repository, setModal, perform, homeCurrency } = useGarage();
  const requested = search.get('car') ?? '';
  // An unknown or deleted vehicle in the link shows every visit instead of an empty list.
  const carId = snapshot.cars.some((car) => car.id === requested) ? requested : '';
  return (
    <HistoryPage
      cars={snapshot.cars}
      visits={visits}
      homeCurrency={homeCurrency}
      repository={repository!}
      carId={carId}
      onCarChange={(id) => router.replace(historyPath(id))}
      onAdd={() => setModal({ kind: 'visit', carId: carId || undefined })}
      onEdit={(item) => setModal({ kind: 'visit', item })}
      onDelete={(visit) =>
        interactions?.confirmDelete({
          title: t('interactions.deleteTitle', {
            name: t('interactions.visitName', {
              vehicle:
                snapshot.cars.find((car) => car.id === visit.carId)?.name ??
                t('shared.serviceVisit'),
              date: display.displayDate(visit.date),
            }),
          }),
          description: t('interactions.deleteVisit'),
          success: 'interactions.visitDeleted',
          onDelete: async () => {
            await perform(() => repository!.deleteVisit(visit));
          },
        })
      }
    />
  );
}
