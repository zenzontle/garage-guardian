'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { failureOf, type AppFailure } from '@/lib/app-error';
import { AccountCard } from './account-card';
import { AccountEmailForm } from './account-email-form';
import { AccountPasswordFields } from './account-password-fields';
import { useGarage } from './garage-provider';

export function AccountRecoveryScreen() {
  const t = useTranslations();
  const garage = useGarage();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<AppFailure | null>(null);
  const [requesting, setRequesting] = useState(false);
  async function cancel() {
    try {
      if (garage.recovering && !(await garage.signOut('local'))) {
        setError({ code: 'auth' });
        return;
      }
      router.replace('/signin');
    } catch (cause) {
      setError(failureOf(cause, 'auth'));
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await garage.resetPassword(password, confirmation);
      router.replace('/signin');
    } catch (cause) {
      setError(failureOf(cause, 'auth'));
    }
  }
  return (
    <AccountCard>
      {garage.loading ? (
        <p role="status">{t('account.wait')}</p>
      ) : requesting ? (
        <AccountEmailForm
          mode="recovery"
          email={garage.accountEmail}
          onEmailChange={garage.setAccountEmail}
          onSubmit={garage.requestRecovery}
          onBack={() => void cancel()}
        />
      ) : garage.recovering ? (
        <>
          <h1>{t('account.resetTitle')}</h1>
          <p>{t('account.resetDescription')}</p>
          {error && (
            <p className="error-banner" role="alert">
              {t(`errors.${error.code}`, error.values)}
            </p>
          )}
          <form className="form-stack" onSubmit={submit} aria-busy={garage.accountBusy}>
            <fieldset className="account-fields" disabled={garage.accountBusy}>
              <AccountPasswordFields
                password={password}
                confirmation={confirmation}
                onPassword={setPassword}
                onConfirmation={setConfirmation}
              />
              <button className="button primary full">
                {t(garage.accountBusy ? 'account.wait' : 'account.resetPassword')}
              </button>
              <button type="button" className="text-link" onClick={() => void cancel()}>
                {t('account.backSignin')}
              </button>
            </fieldset>
          </form>
        </>
      ) : (
        <>
          <h1>{t('account.recoveryTitle')}</h1>
          <p role="alert">
            {t(`errors.${garage.error?.code ?? 'recoveryInvalid'}`, garage.error?.values)}
          </p>
          <button className="button primary full" onClick={() => setRequesting(true)}>
            {t('account.requestAnother')}
          </button>
          <button className="text-link" onClick={() => void cancel()}>
            {t('account.backSignin')}
          </button>
        </>
      )}
    </AccountCard>
  );
}
