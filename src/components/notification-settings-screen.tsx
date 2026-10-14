'use client';

import Link from './guarded-link';
import { useTranslations } from 'next-intl';
import { accountPath } from '@/lib/garage-routes';
import { isCloudConfigured } from '@/lib/repository';
import { useGarage } from './garage-provider';
import { NotificationPreferencesForm } from './notification-preferences-form';

export function NotificationSettingsScreen() {
  const t = useTranslations();
  const garage = useGarage();
  return (
    <div className="form-stack notification-settings">
      <h1>{t('notifications.pageTitle')}</h1>
      {garage.user ? (
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
