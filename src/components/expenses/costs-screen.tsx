'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CostsPage } from './costs-page';
import { useGarage } from '../garage/garage-provider';
import { useInteractions } from '../interaction/interaction-provider';
import { useDisplay } from '@/i18n/use-display';
import { costsPath } from '@/lib/navigation/garage-routes';

export function CostsScreen() {
  const t = useTranslations();
  const interactions = useInteractions();
  const display = useDisplay();
  const router = useRouter();
  const search = useSearchParams();
  const { snapshot, expenses, repository, homeCurrency, setModal, perform, loading } = useGarage();
  const requested = search.get('car') ?? '';
  // An unknown or deleted vehicle in the link shows every cost instead of an empty list.
  const carId = snapshot.cars.some((car) => car.id === requested) ? requested : '';
  return (
    <CostsPage
      loading={loading}
      cars={snapshot.cars}
      expenses={expenses}
      carId={carId}
      homeCurrency={homeCurrency}
      onCarChange={(id) => router.replace(costsPath(id))}
      onAdd={() => setModal({ kind: 'expense', carId: carId || undefined })}
      onAddCar={() => setModal({ kind: 'car' })}
      onImport={() =>
        setModal({ kind: 'import', importKind: 'expense', carId: carId || undefined })
      }
      onEdit={(item) => setModal({ kind: 'expense', item })}
      onDelete={(expense) =>
        interactions?.confirmDelete({
          title: t('interactions.deleteTitle', {
            name: t('interactions.expenseName', {
              vehicle:
                snapshot.cars.find((car) => car.id === expense.carId)?.name ??
                t('expenses.unknown'),
              category: t(`expenses.categories.${expense.category}`),
              date: display.displayDate(expense.date),
            }),
          }),
          description: t('interactions.deleteExpense'),
          success: 'interactions.expenseDeleted',
          onDelete: async () => {
            await perform(() => repository!.deleteExpense(expense));
          },
        })
      }
    />
  );
}
