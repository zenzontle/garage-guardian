'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { isCloudConfigured } from '@/lib/garage/repository';
import { accountPath, type AccountMode } from '@/lib/navigation/garage-routes';
import { AccountForm } from './account-form';
import { useGarage } from '../garage/garage-provider';
import { useGuardedRouter } from '../interaction/guarded-link';

export function AccountScreen({ mode, returnTo }: { mode: AccountMode; returnTo: string }) {
  const garage = useGarage();
  const router = useRouter();
  const navigation = useGuardedRouter();
  const params = useSearchParams();
  const t = useTranslations();

  useEffect(() => {
    if (garage.user || !isCloudConfigured) router.replace(returnTo);
  }, [garage.user, router, returnTo]);

  if (garage.user || !isCloudConfigured) return null;
  return (
    <AccountForm
      key={mode}
      mode={mode}
      email={garage.accountEmail}
      onEmailChange={garage.setAccountEmail}
      onMode={(next) => navigation.replace(accountPath(next, returnTo))}
      onClose={() => navigation.replace(returnTo)}
      onRecovery={garage.requestRecovery}
      onResend={garage.resendConfirmation}
      resendUntil={garage.resendUntil}
      initialResend={params.get('resend') === '1'}
      notice={garage.accountNotice ? t(`account.${garage.accountNotice}`) : undefined}
      onSubmit={async (email, password) => {
        if (mode === 'signup') {
          if (await garage.signUp(email, password)) garage.setNotice(true);
        } else await garage.signIn(email, password);
        if (garage.currentPath.current === `/${mode}`) router.replace(returnTo);
      }}
    />
  );
}
