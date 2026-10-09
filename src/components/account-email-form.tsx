'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { failureOf, type AppFailure } from '@/lib/app-error';

export function AccountEmailForm({
  mode,
  email,
  onEmailChange,
  onSubmit,
  onBack,
  resendUntil = 0,
}: {
  mode: 'recovery' | 'resend';
  email: string;
  onEmailChange: (email: string) => void;
  onSubmit: (email: string) => Promise<void>;
  onBack: () => void;
  resendUntil?: number;
}) {
  const t = useTranslations();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<AppFailure | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    if (resendUntil <= Date.now()) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [resendUntil]);
  const seconds = Math.max(0, Math.ceil((resendUntil - now) / 1000));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSent(false);
    try {
      await onSubmit(email.trim());
      setSent(true);
    } catch (cause) {
      setError(failureOf(cause, 'auth'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1>{t(mode === 'recovery' ? 'account.recoveryTitle' : 'account.resendTitle')}</h1>
      <p>{t(mode === 'recovery' ? 'account.recoveryDescription' : 'account.resendDescription')}</p>
      {error && (
        <p className="error-banner" role="alert">
          {t(`errors.${error.code}`, error.values)}
        </p>
      )}
      {sent && <p role="status">{t('account.emailSent')}</p>}
      <form onSubmit={submit} className="form-stack" aria-busy={busy}>
        <label>
          {t('account.email')}
          <input
            ref={input}
            type="email"
            required
            maxLength={254}
            autoComplete="email"
            value={email}
            disabled={busy}
            onChange={(event) => onEmailChange(event.target.value)}
          />
        </label>
        <button
          className="button primary full"
          disabled={busy || (mode === 'resend' && seconds > 0)}
        >
          {busy
            ? t('account.wait')
            : t(mode === 'recovery' ? 'account.sendRecovery' : 'account.resendConfirmation')}
        </button>
        {mode === 'resend' && seconds > 0 && (
          <p role="status">{t('account.cooldown', { seconds })}</p>
        )}
        <button type="button" className="text-link" disabled={busy} onClick={onBack}>
          {t('account.backSignin')}
        </button>
      </form>
    </>
  );
}
