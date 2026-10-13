'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { accountPath } from '@/lib/garage-routes';
import { isCloudConfigured } from '@/lib/repository';
import { useGarage } from './garage-provider';
import { AccountSettingsForm } from './account-settings-form';

export function AccountSettingsScreen({ section }: { section: 'account' | 'security' }) {
  const t = useTranslations();
  const garage = useGarage();
  return (
    <div className="form-stack account-settings">
      <h1>{t(section === 'security' ? 'account.security' : 'account.settings')}</h1>
      {garage.user ? (
        <div key={garage.user.id} className="form-stack account-section">
          <p>{t('account.currentEmail', { email: garage.user.email ?? '' })}</p>
          {section === 'security' && (
            <>
              {garage.transferring && <p role="status">{t('account.transferBlocked')}</p>}
              {(['email', 'password'] as const).map((kind) => (
                <AccountSettingsForm
                  key={kind}
                  kind={kind}
                  disabled={garage.accountBusy || garage.transferring || garage.loading}
                  headingLevel={2}
                />
              ))}
            </>
          )}
        </div>
      ) : (
        isCloudConfigured && (
          <Link className="button primary" href={accountPath('signin', `/settings/${section}`)}>
            {t('account.signIn')}
          </Link>
        )
      )}
    </div>
  );
}
