'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { failureOf, type AppFailure } from '@/lib/app-error';
import { AccountPasswordFields } from './account-password-fields';
import { useGarage } from './garage-provider';

export function AccountSettingsForm({
  kind,
  disabled,
}: {
  kind: 'email' | 'password';
  disabled: boolean;
}) {
  const t = useTranslations();
  const garage = useGarage();
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<AppFailure | null>(null);
  const [pendingEmail, setPendingEmail] = useState('');
  const title = kind === 'email' ? 'changeEmail' : 'changePassword';
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      if (kind === 'email') {
        await garage.changeEmail(currentPassword, email.trim());
        setPendingEmail(email.trim());
      } else {
        await garage.changePassword(currentPassword, password, confirmation);
        router.replace('/signin');
      }
      setCurrentPassword('');
      setPassword('');
      setConfirmation('');
    } catch (cause) {
      setError(failureOf(cause, 'auth'));
    }
  }
  const pending = garage.user?.new_email ?? pendingEmail;
  return (
    <form
      className="form-stack account-section"
      onSubmit={submit}
      aria-label={t(`account.${title}`)}
      aria-busy={garage.accountBusy}
    >
      <h3>{t(`account.${title}`)}</h3>
      {error && (
        <p className="error-banner" role="alert">
          {t(`errors.${error.code}`, error.values)}
        </p>
      )}
      {kind === 'email' && pending && pending !== garage.user?.email && (
        <p role="status">{t('account.pendingEmail', { email: pending })}</p>
      )}
      <fieldset className="account-fields" disabled={disabled}>
        <label>
          {t('account.currentPassword')}
          <input
            type="password"
            autoComplete="current-password"
            required
            maxLength={1024}
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </label>
        {kind === 'email' && (
          <label>
            {t('account.newEmail')}
            <input
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
        )}
        {kind === 'password' && (
          <AccountPasswordFields
            password={password}
            confirmation={confirmation}
            onPassword={setPassword}
            onConfirmation={setConfirmation}
          />
        )}
        <button className="button primary">
          {t(garage.accountBusy ? 'account.wait' : `account.${title}`)}
        </button>
      </fieldset>
    </form>
  );
}
