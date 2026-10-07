'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CircleAlert, LogOut, X } from 'lucide-react';
import { getAllDue } from '@/lib/due';
import { isCloudConfigured } from '@/lib/repository';
import { useGarageSession } from '@/lib/use-garage-session';
import { makeStarterSchedules, type Car, type ScheduleItem, type Visit } from '@/lib/model';
import { BugReporter } from './bug-reporter';
import { LocaleSelector } from './locale-selector';
import { AccountForm } from './account-form';
import { Dashboard } from './dashboard';
import { CarsPage } from './cars-page';
import { HistoryPage } from './history-page';
import { ReportsPage } from './reports-page';
import { CarModal } from './car-modal';
import { ScheduleModal } from './schedule-modal';
import { VisitModal } from './visit-modal';
import { todayISO } from '@/lib/today-iso';
import type { Page } from './garage-navigation';
import { GarageSidebar } from './garage-sidebar';
import { GarageTopbar } from './garage-topbar';
import { GarageMobileNavigation } from './garage-mobile-navigation';

type ModalState =
  | { kind: 'car'; item?: Car }
  | { kind: 'schedule'; item?: ScheduleItem; carId: string }
  | { kind: 'visit'; item?: Visit; carId?: string }
  | null;

export function GarageContent() {
  const t = useTranslations();
  const garage = useGarageSession();
  const { repository, snapshot, user, loading, transferring, error, setError } = garage;
  const [page, setPage] = useState<Page>('dashboard');
  const [modal, setModal] = useState<ModalState>(null);
  const [selectedCarId, setSelectedCarId] = useState<string>('');
  const [authView, setAuthView] = useState<'signin' | 'signup' | null>(null);
  const [notice, setNotice] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (loading) {
      setModal(null);
      setSelectedCarId('');
    }
    if (user) {
      setAuthView(null);
      setNotice(false);
    }
  }, [loading, user]);

  async function perform(action: () => Promise<void>) {
    await garage.run(action);
    setModal(null);
  }

  const allDue = useMemo(
    () => getAllDue(snapshot.cars, snapshot.schedules, snapshot.visits, todayISO()),
    [snapshot],
  );
  const visits = useMemo(
    () =>
      [...snapshot.visits].sort(
        (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt),
      ),
    [snapshot.visits],
  );
  const selectedCar = snapshot.cars.find((car) => car.id === selectedCarId) ?? null;
  const reporter = (
    <BugReporter
      key={user?.id ?? 'guest'}
      userId={user?.id}
      screen={loading ? 'loading' : !repository ? 'recovery' : page}
      dialog={
        modal?.kind === 'car' ? (modal.item ? 'edit-car' : 'add-car') : (modal?.kind ?? 'none')
      }
    />
  );

  const accountActions = user ? (
    <button className="button secondary" onClick={() => void garage.signOut()}>
      <LogOut size={17} />
      {t('account.signOut')}
    </button>
  ) : (
    isCloudConfigured && (
      <div className="account-actions">
        <button className="button secondary" onClick={() => setAuthView('signin')}>
          {t('account.signIn')}
        </button>
        <button className="button primary" onClick={() => setAuthView('signup')}>
          {t('account.create')}
        </button>
      </div>
    )
  );

  if (loading || !repository)
    return (
      <>
        {reporter}
        <div className="auth-page">
          <div className="auth-card">
            {!loading && <LocaleSelector />}
            <h1>{transferring ? t('app.moving') : t('app.opening')}</h1>
            {loading ? (
              <p role="status">{transferring ? t('app.uploading') : t('app.loading')}</p>
            ) : (
              <>
                <p className="error-text" role="alert">
                  {error ? t(`errors.${error.code}`, error.values) : t('errors.load')}
                </p>
                <button className="button primary" onClick={garage.retry}>
                  {t('shared.retry')}
                </button>
              </>
            )}
            {user && <div className="recovery-actions">{accountActions}</div>}
          </div>
        </div>
      </>
    );
  if (authView && !user)
    return (
      <AccountForm
        mode={authView}
        onMode={setAuthView}
        onClose={() => setAuthView(null)}
        onSubmit={async (email, password) => {
          if (authView === 'signup') {
            const confirmation = await garage.signUp(email, password);
            if (confirmation) setNotice(true);
          } else await garage.signIn(email, password);
          setAuthView(null);
        }}
      />
    );

  return (
    <>
      {reporter}
      <div className="app-shell">
        <GarageSidebar
          page={page}
          menuOpen={menuOpen}
          carCount={snapshot.cars.length}
          user={user}
          onNavigate={(next) => {
            setPage(next);
            setMenuOpen(false);
          }}
        />

        <div className="main-wrap">
          <GarageTopbar page={page} onMenuToggle={() => setMenuOpen(!menuOpen)} />
          <main className="content">
            {isCloudConfigured && (
              <div className="storage-account">
                <span>{user ? t('app.cloudStorage') : t('app.guestStorage')}</span>
                {accountActions}
              </div>
            )}
            {notice && (
              <div className="demo-banner" role="status">
                {t('account.confirmation')}
              </div>
            )}
            {error && (
              <div className="error-banner" role="alert">
                <CircleAlert size={18} />
                {t(`errors.${error.code}`, error.values)}
                <button aria-label={t('app.dismissError')} onClick={() => setError(null)}>
                  <X size={16} />
                </button>
              </div>
            )}
            {!isCloudConfigured && (
              <div className="demo-banner">
                <CircleAlert size={17} />
                <span>{t('app.prototypeNotice')}</span>
              </div>
            )}
            {page === 'dashboard' && (
              <Dashboard
                cars={snapshot.cars}
                visits={visits}
                allDue={allDue}
                onAddCar={() => setModal({ kind: 'car' })}
                onAddVisit={() => setModal({ kind: 'visit' })}
                onViewCar={(id) => {
                  setSelectedCarId(id);
                  setPage('cars');
                }}
                onViewAll={() => setPage('history')}
              />
            )}
            {page === 'cars' && (
              <CarsPage
                cars={snapshot.cars}
                schedules={snapshot.schedules}
                visits={visits}
                allDue={allDue}
                selectedCar={selectedCar}
                onSelect={setSelectedCarId}
                onAdd={() => setModal({ kind: 'car' })}
                onEdit={(item) => setModal({ kind: 'car', item })}
                onAddSchedule={(carId) => setModal({ kind: 'schedule', carId })}
                onEditSchedule={(item) => setModal({ kind: 'schedule', carId: item.carId, item })}
                onAddVisit={(carId) => setModal({ kind: 'visit', carId })}
                onDeleteCar={async (car) => {
                  if (confirm(t('car.confirmDelete', { name: car.name })))
                    await perform(() => repository!.deleteCar(car.id));
                }}
                onDeleteSchedule={async (item) => {
                  if (confirm(t('car.confirmDeleteTask', { name: item.name })))
                    await perform(() => repository!.deleteSchedule(item.id));
                }}
              />
            )}
            {page === 'history' && (
              <HistoryPage
                cars={snapshot.cars}
                visits={visits}
                repository={repository!}
                onAdd={() => setModal({ kind: 'visit' })}
                onEdit={(item) => setModal({ kind: 'visit', item })}
                onDelete={async (visit) => {
                  if (confirm(t('history.confirmDelete')))
                    await perform(() => repository!.deleteVisit(visit));
                }}
              />
            )}
            {page === 'reports' && <ReportsPage cars={snapshot.cars} visits={visits} />}
          </main>
        </div>

        <GarageMobileNavigation page={page} onNavigate={setPage} />

        {modal?.kind === 'car' && (
          <CarModal
            item={modal.item}
            onClose={() => setModal(null)}
            onSave={async (car, starter) => {
              await perform(async () => {
                await repository!.saveCar(car);
                if (starter)
                  for (const item of makeStarterSchedules(car.id, [
                    t('starter.oil'),
                    t('starter.rotation'),
                    t('starter.tires'),
                    t('starter.engineFilter'),
                    t('starter.cabinFilter'),
                    t('starter.service'),
                  ]))
                    await repository!.saveSchedule(item);
              });
              setSelectedCarId(car.id);
              setPage('cars');
            }}
          />
        )}
        {modal?.kind === 'schedule' && (
          <ScheduleModal
            item={modal.item}
            carId={modal.carId}
            distanceUnit={
              snapshot.cars.find((car) => car.id === modal.carId)?.distanceUnit ?? 'miles'
            }
            onClose={() => setModal(null)}
            onSave={async (item) => perform(() => repository!.saveSchedule(item))}
          />
        )}
        {modal?.kind === 'visit' && (
          <VisitModal
            item={modal.item}
            carId={modal.carId}
            cars={snapshot.cars}
            visits={visits}
            schedules={snapshot.schedules}
            repository={repository!}
            onClose={() => setModal(null)}
            onSave={async (item) => perform(() => repository!.saveVisit(item))}
          />
        )}
      </div>
    </>
  );
}
