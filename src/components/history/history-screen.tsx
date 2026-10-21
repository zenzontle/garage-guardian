'use client';

import { useTranslations } from 'next-intl';
import { HistoryPage } from './history-page';
import { useGarage } from '../garage/garage-provider';
import { useInteractions } from '../interaction/interaction-provider';
import { useDisplay } from '@/i18n/use-display';

export function HistoryScreen() {
  const t = useTranslations();
  const interactions = useInteractions();
  const display = useDisplay();
  const { snapshot, visits, repository, setModal, perform, homeCurrency } = useGarage();
  return (
    <HistoryPage
      cars={snapshot.cars}
      visits={visits}
      homeCurrency={homeCurrency}
      repository={repository!}
      onAdd={() => setModal({ kind: 'visit' })}
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
