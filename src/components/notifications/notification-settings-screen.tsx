'use client';

import Link from '../interaction/guarded-link';
import { useTranslations } from 'next-intl';
import { accountPath } from '@/lib/navigation/garage-routes';
import { isCloudConfigured } from '@/lib/garage/repository';
import { useGarage } from '../garage/garage-provider';
import { NotificationPreferencesForm } from './notification-preferences-form';
import { Skeleton } from '../ui/skeleton';

export function NotificationSettingsScreen() {
  const t = useTranslations();
  const garage = useGarage();
  return (
    <div className="form-stack notification-settings">
      <h1>{t('notifications.pageTitle')}</h1>
      {/* The session isn't known yet, so a signed-in owner would briefly see a sign-in prompt. */}
      {garage.loading && !garage.user ? (
        <Skeleton className="skeleton-control" width="16rem" />
      ) : garage.user ? (
        <NotificationPreferencesForm
          key={garage.user.id}
          userId={garage.user.id}
          disabled={garage.accountBusy || garage.transferring || garage.loading}
          headingLevel={2}
        />
      ) : (
        <>
          <p>{t('notifications.signIn')}</p>
          {isCloudConfigured && (
            <Link
              className="button primary"
              href={accountPath('signin', '/settings/notifications')}
            >
              {t('account.signIn')}
            </Link>
          )}
        </>
      )}
    </div>
  );
}
