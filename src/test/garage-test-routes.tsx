import { validatedReturnTo } from '@/lib/navigation/garage-routes';
export type Screens = typeof import('@/components/dashboard/dashboard-screen') &
  typeof import('@/components/vehicles/cars-screen') &
  typeof import('@/components/history/history-screen') &
  typeof import('@/components/reports/reports-screen') &
  typeof import('@/components/account/account-screen') &
  typeof import('@/components/account/account-recovery-screen') &
  typeof import('@/components/notifications/notification-settings-screen') &
  typeof import('@/components/account/account-settings-screen');

export function TestRoutes({ screens, url }: { screens: Screens; url: string }) {
  const pathname = new URL(url, 'http://localhost').pathname;
  if (pathname === '/') return <screens.DashboardScreen />;
  if (pathname === '/cars') return <screens.CarsScreen />;
  if (pathname.startsWith('/cars/'))
    return <screens.CarsScreen carId={decodeURIComponent(pathname.slice(6))} />;
  if (pathname === '/history') return <screens.HistoryScreen />;
  if (pathname === '/reports') return <screens.ReportsScreen />;
  if (pathname === '/settings/notifications') return <screens.NotificationSettingsScreen />;
  if (pathname === '/settings/account') return <screens.AccountSettingsScreen section="account" />;
  if (pathname === '/settings/security')
    return <screens.AccountSettingsScreen section="security" />;
  if (pathname === '/auth/recovery') return <screens.AccountRecoveryScreen />;
  if (pathname === '/signin' || pathname === '/signup')
    return (
      <screens.AccountScreen
        mode={pathname === '/signin' ? 'signin' : 'signup'}
        returnTo={validatedReturnTo(new URL(url, 'http://localhost').searchParams.get('returnTo'))}
      />
    );
  return <h1>Not found</h1>;
}
