'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { AccountCard } from './account-card';
import { AccountEmailForm } from './account-email-form';
import { failureOf, type AppFailure } from '@/lib/app-error';

export function AccountForm({
  mode,
  email,
  onEmailChange,
  onMode,
  onClose,
  onSubmit,
  onRecovery,
  onResend,
  resendUntil,
  initialResend,
  notice,
}: {
  mode: 'signin' | 'signup';
  email: string;
  onEmailChange: (email: string) => void;
  onMode: (mode: 'signin' | 'signup') => void;
  onClose: () => void;
  onSubmit: (email: string, password: string) => Promise<void>;
  onRecovery: (email: string) => Promise<void>;
  onResend: (email: string) => Promise<void>;
  resendUntil: number;
  initialResend?: boolean;
  notice?: string;
}) {
  const t = useTranslations();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppFailure | null>(null);
  const [emailMode, setEmailMode] = useState<'recovery' | 'resend' | null>(
    initialResend ? 'resend' : null,
  );
  const signup = mode === 'signup';
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(email.trim(), password);
    } catch (cause) {
      setError(failureOf(cause, 'auth'));
    } finally {
      setBusy(false);
    }
  }
  if (emailMode)
    return (
      <AccountCard>
        <AccountEmailForm
          mode={emailMode}
          email={email}
          onEmailChange={onEmailChange}
          onSubmit={emailMode === 'recovery' ? onRecovery : onResend}
          resendUntil={resendUntil}
          onBack={() => {
            setEmailMode(null);
            setError(null);
            setPassword('');
          }}
        />
      </AccountCard>
    );
  return (
    <AccountCard>
      {notice && <p role="status">{notice}</p>}
      <h1>{signup ? t('account.createTitle') : t('account.welcome')}</h1>
      <p>{signup ? t('account.signupDescription') : t('account.signinDescription')}</p>
      {error && (
        <div className="error-banner" role="alert">
          {t(`errors.${error.code}`, error.values)}
        </div>
      )}
      <form onSubmit={submit} className="form-stack" aria-busy={busy}>
        <label>
          {t('account.email')}
          <input
            type="email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            required
            autoComplete="email"
            disabled={busy}
          />
        </label>
        <label>
          {t('account.password')}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={signup ? 6 : undefined}
            autoComplete={signup ? 'new-password' : 'current-password'}
            disabled={busy}
          />
        </label>
        <button className="button primary full" disabled={busy}>
          {busy ? t('account.wait') : signup ? t('account.create') : t('account.signIn')}
          <ArrowRight size={17} />
        </button>
        <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
          {t('account.continueGuest')}
        </button>
        <button
          type="button"
          className="text-link"
          disabled={busy}
          onClick={() => {
            setError(null);
            setPassword('');
            onMode(signup ? 'signin' : 'signup');
          }}
        >
          {signup ? t('account.existingAccount') : t('account.createLink')}
        </button>
        {!signup && (
          <>
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => {
                setPassword('');
                setEmailMode('recovery');
              }}
            >
              {t('account.forgotPassword')}
            </button>
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => {
                setPassword('');
                setEmailMode('resend');
              }}
            >
              {t('account.resendConfirmation')}
            </button>
          </>
        )}
      </form>
    </AccountCard>
  );
}
