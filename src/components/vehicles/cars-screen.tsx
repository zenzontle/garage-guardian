'use client';

import { useEffect, useState } from 'react';
import Link from '../interaction/guarded-link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CarFront } from 'lucide-react';
import { isCloudConfigured } from '@/lib/garage/repository';
import { accountPath, carPath } from '@/lib/navigation/garage-routes';
import { CarsPage } from './cars-page';
import { EmptyPanel } from '../ui/empty-panel';
import { PageHeading } from '../ui/page-heading';
import { useGarage } from '../garage/garage-provider';
import { useInteractions } from '../interaction/interaction-provider';
import { useFormInteraction } from '../interaction/use-form-interaction';
import { failureOf, type AppFailure } from '@/lib/utils/app-error';

export function CarsScreen({ carId }: { carId?: string }) {
  const t = useTranslations();
  const interactions = useInteractions();
  const {
    snapshot,
    visits,
    fuelEntries,
    allDue,
    user,
    repository,
    setModal,
    perform,
    currentPath,
    setCarArchived,
  } = useGarage();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const selectedCar = snapshot.cars.find((car) => car.id === carId) ?? null;
  const archived = selectedCar?.isArchived ?? search.get('view') === 'archived';
  const cars = snapshot.cars.filter((car) => car.isArchived === archived);
  const firstCar = cars[0];
  const [busy, setBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<AppFailure | null>(null);
  const interaction = useFormInteraction(null, { busy });

  async function restore() {
    if (!selectedCar?.isArchived || !interaction.begin()) return;
    setBusy(true);
    setArchiveError(null);
    try {
      await setCarArchived(selectedCar.id, false);
      interactions?.notify('interactions.carRestored');
    } catch (cause) {
      setArchiveError(failureOf(cause, 'archive'));
    } finally {
      interaction.end();
      setBusy(false);
    }
  }

  useEffect(() => setArchiveError(null), [carId]);

  useEffect(() => {
    if (!carId && firstCar) router.replace(carPath(firstCar.id));
  }, [carId, firstCar, router]);

  if (!carId && firstCar) return <p role="status">{t('app.loading')}</p>;
  if (carId && !selectedCar)
    return (
      <>
        <PageHeading
          eyebrow={t('dashboard.yourVehicles')}
          title={t('navigation.cars')}
          description={t('car.description')}
        />
        <EmptyPanel
          icon={<CarFront size={25} />}
          title={t('car.unavailableTitle')}
          description={t('car.unavailableDescription')}
          action={
            <div className="account-actions">
              <Link className="button secondary" href="/cars">
                {t('navigation.cars')}
              </Link>
              {isCloudConfigured && !user && (
                <Link className="button primary" href={accountPath('signin', pathname)}>
                  {t('account.signIn')}
                </Link>
              )}
            </div>
          }
        />
      </>
    );
  return (
    <CarsPage
      cars={cars}
      archived={archived}
      hasArchived={snapshot.cars.some((car) => car.isArchived)}
      schedules={snapshot.schedules}
      archiveBusy={busy}
      archiveError={archiveError}
      onRestore={() => interaction.request(() => void restore())}
      visits={visits}
      fuelEntries={fuelEntries}
      allDue={allDue}
      selectedCar={selectedCar}
      onAdd={() => setModal({ kind: 'car' })}
      onEdit={(item) => setModal({ kind: 'car', item })}
      onAddSchedule={(id) => setModal({ kind: 'schedule', carId: id })}
      onEditSchedule={(item) => setModal({ kind: 'schedule', carId: item.carId, item })}
      onAddVisit={(id) => setModal({ kind: 'visit', carId: id })}
      onAddFuel={(id) => setModal({ kind: 'fuel', carId: id })}
      onDeleteCar={(car) =>
        interactions?.confirmDelete({
          title: t('interactions.deleteTitle', { name: car.name }),
          description: t('interactions.deleteCar'),
          success: 'interactions.carDeleted',
          onDelete: async () => {
            const result = await perform(() => repository!.deleteCar(car.id));
            if (result.refreshed && currentPath.current === pathname)
              router.replace(car.isArchived ? '/cars?view=archived' : '/cars');
          },
        })
      }
      onDeleteSchedule={(item) =>
        interactions?.confirmDelete({
          title: t('interactions.deleteTitle', { name: item.name }),
          description: t('interactions.deleteTask'),
          success: 'interactions.taskDeleted',
          onDelete: async () => {
            await perform(() => repository!.deleteSchedule(item.id));
          },
        })
      }
    />
  );
}
