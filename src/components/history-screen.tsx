'use client';

import { useTranslations } from 'next-intl';
import { HistoryPage } from './history-page';
import { useGarage } from './garage-provider';

export function HistoryScreen() {
  const t = useTranslations();
  const { snapshot, visits, repository, setModal, perform } = useGarage();
  return (
    <HistoryPage
      cars={snapshot.cars}
      visits={visits}
      repository={repository!}
      onAdd={() => setModal({ kind: 'visit' })}
      onEdit={(item) => setModal({ kind: 'visit', item })}
      onDelete={async (visit) => {
        if (!confirm(t('history.confirmDelete'))) return;
        try {
          await perform(() => repository!.deleteVisit(visit));
        } catch {
          /* The session displays the failure. */
        }
      }}
    />
  );
}
