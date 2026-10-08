'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import { GarageLogo } from './garage-logo';
import { LocaleSelector } from './locale-selector';
import { failureOf, type AppFailure } from '@/lib/app-error';

export function AccountForm({
  mode,
  email,
  onEmailChange,
  onMode,
  onClose,
  onSubmit,
}: {
  mode: 'signin' | 'signup';
  email: string;
  onEmailChange: (email: string) => void;
  onMode: (mode: 'signin' | 'signup') => void;
  onClose: () => void;
  onSubmit: (email: string, password: string) => Promise<void>;
}) {
  const t = useTranslations();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AppFailure | null>(null);
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
  return (
    <div className="auth-page">
      <div className="auth-card">
        <LocaleSelector />
        <div className="brand">
          <div className="brand-mark">
            <GarageLogo />
          </div>
          <div>
            <strong>Garage Guardian</strong>
            <small>{t('app.tagline')}</small>
          </div>
        </div>
        <h1>{signup ? t('account.createTitle') : t('account.welcome')}</h1>
        <p>{signup ? t('account.signupDescription') : t('account.signinDescription')}</p>
        {error && (
          <div className="error-banner" role="alert">
            {t(`errors.${error.code}`, error.values)}
          </div>
        )}
        <form onSubmit={submit} className="form-stack">
          <label>
            {t('account.email')}
            <input
              type="email"
              value={email}
              onChange={(e) => onEmailChange(e.target.value)}
              required
              autoComplete="email"
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
        </form>
      </div>
    </div>
  );
}
