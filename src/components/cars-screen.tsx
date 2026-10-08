'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CarFront } from 'lucide-react';
import { isCloudConfigured } from '@/lib/repository';
import { accountPath, carPath } from '@/lib/garage-routes';
import { CarsPage } from './cars-page';
import { EmptyPanel } from './empty-panel';
import { PageHeading } from './page-heading';
import { useGarage } from './garage-provider';

export function CarsScreen({ carId }: { carId?: string }) {
  const t = useTranslations();
  const { snapshot, visits, allDue, user, repository, setModal, perform, currentPath } =
    useGarage();
  const router = useRouter();
  const pathname = usePathname();
  const firstCar = snapshot.cars[0];
  const selectedCar = snapshot.cars.find((car) => car.id === carId) ?? null;

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
      cars={snapshot.cars}
      visits={visits}
      allDue={allDue}
      selectedCar={selectedCar}
      onAdd={() => setModal({ kind: 'car' })}
      onEdit={(item) => setModal({ kind: 'car', item })}
      onAddSchedule={(id) => setModal({ kind: 'schedule', carId: id })}
      onEditSchedule={(item) => setModal({ kind: 'schedule', carId: item.carId, item })}
      onAddVisit={(id) => setModal({ kind: 'visit', carId: id })}
      onDeleteCar={async (car) => {
        if (!confirm(t('car.confirmDelete', { name: car.name }))) return;
        try {
          await perform(() => repository!.deleteCar(car.id));
          if (currentPath.current === pathname) router.replace('/cars');
        } catch {
          /* The session displays the failure; retain the requested vehicle. */
        }
      }}
      onDeleteSchedule={async (item) => {
        if (!confirm(t('car.confirmDeleteTask', { name: item.name }))) return;
        try {
          await perform(() => repository!.deleteSchedule(item.id));
        } catch {
          /* The session displays the failure. */
        }
      }}
    />
  );
}
