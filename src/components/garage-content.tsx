'use client';

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CircleAlert, LogOut, X } from 'lucide-react';
import { isCloudConfigured } from '@/lib/repository';
import { makeStarterSchedules } from '@/lib/model';
import { accountMode, accountPath, carPath, workspaceScreen } from '@/lib/garage-routes';
import { useGarage } from './garage-provider';
import { BugReporter } from './bug-reporter';
import { LocaleSelector } from './locale-selector';
import { CarModal } from './car-modal';
import { ScheduleModal } from './schedule-modal';
import { VisitModal } from './visit-modal';
import { GarageSidebar } from './garage-sidebar';
import { GarageTopbar } from './garage-topbar';
import { GarageMobileNavigation } from './garage-mobile-navigation';
import { AccountSettingsDialog } from './account-settings-dialog';
import { AccountRecoveryScreen } from './account-recovery-screen';

export function GarageContent({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const garage = useGarage();
  const {
    repository,
    snapshot,
    user,
    loading,
    transferring,
    error,
    setError,
    refreshError,
    setRefreshError,
    refreshing,
    refresh,
    modal,
    setModal,
    notice,
    menuOpen,
    setMenuOpen,
    visits,
    perform,
    currentPath,
  } = garage;
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), [setMenuOpen]);
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    if (garage.recovering && pathname !== '/auth/recovery') router.replace('/auth/recovery');
  }, [garage.recovering, pathname, router]);
  const page = workspaceScreen(pathname);
  const reporter = (
    <BugReporter
      key={user?.id ?? 'guest'}
      userId={user?.id}
      screen={loading ? 'loading' : !repository ? 'recovery' : page}
      dialog={
        modal?.kind === 'car'
          ? modal.item
            ? 'edit-car'
            : 'add-car'
          : modal?.kind === 'account'
            ? 'none'
            : (modal?.kind ?? 'none')
      }
    />
  );

  const accountActions = user ? (
    <div className="account-actions">
      <button
        className="button secondary"
        disabled={garage.accountBusy}
        onClick={() => setModal({ kind: 'account' })}
      >
        {t('account.settings')}
      </button>
      <button
        className="button secondary"
        disabled={garage.accountBusy}
        onClick={() => void garage.signOut()}
      >
        <LogOut size={17} />
        {t('account.signOut')}
      </button>
    </div>
  ) : (
    isCloudConfigured && (
      <div className="account-actions">
        <Link className="button secondary" href={accountPath('signin', pathname)}>
          {t('account.signIn')}
        </Link>
        <Link className="button primary" href={accountPath('signup', pathname)}>
          {t('account.create')}
        </Link>
      </div>
    )
  );

  if (garage.recovering) return <AccountRecoveryScreen />;
  if (pathname === '/auth/recovery') return <>{children}</>;
  const settings =
    modal?.kind === 'account' && user ? <AccountSettingsDialog key={`account:${user.id}`} /> : null;
  if (loading || !repository)
    return (
      <>
        {reporter}
        {settings}
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
            {!loading && user && <div className="recovery-actions">{accountActions}</div>}
          </div>
        </div>
      </>
    );
  if (accountMode(pathname)) return <>{children}</>;

  return (
    <>
      {reporter}
      <div className="app-shell">
        <GarageSidebar
          page={page}
          menuOpen={menuOpen}
          onNavigate={closeMenu}
          menuTrigger={menuTrigger}
          carCount={snapshot.cars.length}
          user={user}
        />

        <div className="main-wrap">
          <GarageTopbar
            page={page}
            menuOpen={menuOpen}
            menuTrigger={menuTrigger}
            onMenuToggle={() => setMenuOpen(!menuOpen)}
          />
          <main className="content">
            {isCloudConfigured && (
              <div className="storage-account">
                {!user && <span>{t('app.guestStorage')}</span>}
                {accountActions}
              </div>
            )}
            {notice && (
              <div className="demo-banner" role="status">
                {t('account.confirmation')}
                <Link className="text-link" href={`${accountPath('signin', pathname)}&resend=1`}>
                  {t('account.resendConfirmation')}
                </Link>
              </div>
            )}
            {garage.accountNotice && (
              <div className="demo-banner" role="status">
                {t(`account.${garage.accountNotice}`)}
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
            {refreshError && (
              <div className="error-banner refresh-banner" role="alert" aria-busy={refreshing}>
                <CircleAlert size={18} />
                <span>{t(`errors.${refreshError.code}`, refreshError.values)}</span>
                <button type="button" disabled={refreshing} onClick={() => void refresh()}>
                  {t('shared.retryRefresh')}
                </button>
                <button
                  type="button"
                  aria-label={t('app.dismissError')}
                  onClick={() => setRefreshError(null)}
                >
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
            {children}
            <footer className="app-footer">
              <span>© 2026 Jorge Hernandez</span>
              <a className="text-link" href="https://github.com/zenzontle/garage-guardian">
                GitHub
              </a>
            </footer>
          </main>
        </div>

        <GarageMobileNavigation page={page} />
        {settings}

        {modal?.kind === 'car' && (
          <CarModal
            item={modal.item}
            onClose={() => setModal(null)}
            onSave={async (car, starter) => {
              const result = await perform(async () => {
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
              if (result.refreshed && !modal.item && currentPath.current === pathname)
                router.push(carPath(car.id));
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
            onSave={async (item) => {
              await perform(() => repository!.saveSchedule(item));
            }}
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
            onSave={async (item) => {
              await perform(() => repository!.saveVisit(item));
            }}
          />
        )}
      </div>
    </>
  );
}
