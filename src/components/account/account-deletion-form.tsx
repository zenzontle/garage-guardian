'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { failureOf, type AppFailure } from '@/lib/utils/app-error';
import { useGarage } from '../garage/garage-provider';
import { useFormInteraction } from '../interaction/use-form-interaction';

export function AccountDeletionForm({
  disabled,
  headingLevel = 3,
}: {
  disabled: boolean;
  headingLevel?: 2 | 3 | 4;
}) {
  const t = useTranslations();
  const garage = useGarage();
  const router = useRouter();
  const descriptionId = useId();
  const [currentPassword, setCurrentPassword] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<AppFailure | null>(null);
  const Heading = headingLevel === 2 ? 'h2' : headingLevel === 4 ? 'h4' : 'h3';
  const interaction = useFormInteraction(
    { currentPassword, confirmed },
    {
      busy: garage.accountBusy,
      group: 'account-settings',
      onDiscard: () => {
        setCurrentPassword('');
        setConfirmed(false);
      },
    },
  );
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || !confirmed || !interaction.begin()) return;
    setError(null);
    try {
      await garage.deleteAccount(currentPassword);
      interaction.accept({ currentPassword: '', confirmed: false });
      setCurrentPassword('');
      setConfirmed(false);
      garage.setModal(null);
      router.replace('/');
    } catch (cause) {
      setError(failureOf(cause, 'auth'));
    } finally {
      interaction.end();
    }
  }
  return (
    <form
      className="form-stack account-section"
      onSubmit={submit}
      aria-label={t('account.deleteAccount')}
      aria-describedby={descriptionId}
      aria-busy={garage.accountBusy}
    >
      <Heading>{t('account.deleteAccount')}</Heading>
      <div id={descriptionId} className="form-stack">
        <p>{t('account.deleteAccountDescription')}</p>
        <p>{t('account.deleteAccountKeep')}</p>
      </div>
      {error && (
        <p className="error-banner" role="alert">
          {t(`errors.${error.code}`, error.values)}
        </p>
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
        <label className="checkbox-line">
          <input
            type="checkbox"
            required
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          {t('account.deleteAccountConfirm')}
        </label>
        <button className="button danger" disabled={!confirmed}>
          {t(garage.accountBusy ? 'account.wait' : 'account.deleteAccount')}
        </button>
      </fieldset>
    </form>
  );
}
