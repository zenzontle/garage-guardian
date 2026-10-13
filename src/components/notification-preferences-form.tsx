'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { notificationRequest } from '@/lib/notification-client';
import type { NotificationPreferences } from '@/lib/notification-preferences';
import { failureOf, type AppFailure } from '@/lib/app-error';

export function NotificationPreferencesForm({
  userId,
  disabled = false,
  onBusyChange,
  headingLevel = 3,
}: {
  userId: string;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  headingLevel?: 2 | 3 | 4;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [error, setError] = useState<AppFailure | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reload, setReload] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const initialLanguage = useRef(locale);
  const Heading = headingLevel === 2 ? 'h2' : headingLevel === 4 ? 'h4' : 'h3';

  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    setPreferences(null);
    setError(null);
    setSaved(false);
    notificationRequest(userId, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted)
          setPreferences(
            value ?? {
              enabled: false,
              weekday: 1,
              emailLanguage: initialLanguage.current,
              nextScheduledAt: null,
            },
          );
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setError(failureOf(cause, 'notificationSave'));
      });
    return () => abort.abort();
  }, [userId, reload]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const abort = controller.current;
    if (!preferences || !abort || saving) return;
    setSaving(true);
    onBusyChange?.(true);
    setSaved(false);
    setError(null);
    try {
      const result = await notificationRequest(userId, abort.signal, {
        enabled: preferences.enabled,
        weekday: preferences.weekday,
        emailLanguage: preferences.emailLanguage,
      });
      if (!abort.signal.aborted) {
        setPreferences(result);
        setSaved(true);
      }
    } catch (cause) {
      if (!abort.signal.aborted) setError(failureOf(cause, 'notificationSave'));
    } finally {
      if (!abort.signal.aborted) {
        setSaving(false);
        onBusyChange?.(false);
      }
    }
  }
  function edit(patch: Partial<NotificationPreferences>) {
    setPreferences((previous) => (previous ? { ...previous, ...patch } : previous));
    setSaved(false);
  }
  return (
    <form
      className="form-stack account-section"
      aria-label={t('notifications.title')}
      aria-busy={(!preferences && !error) || saving}
      onSubmit={submit}
    >
      <Heading>{t('notifications.title')}</Heading>
      <p>{t('notifications.description')}</p>
      {error && (
        <p className="error-banner" role="alert">
          {t(`errors.${error.code}`)}
        </p>
      )}
      {!preferences &&
        (error ? (
          <button
            type="button"
            className="button secondary"
            onClick={() => setReload((value) => value + 1)}
          >
            {t('shared.retry')}
          </button>
        ) : (
          <p role="status">{t('notifications.loading')}</p>
        ))}
      {preferences && (
        <>
          <fieldset className="account-fields" disabled={disabled || saving}>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={preferences.enabled}
                onChange={(event) => edit({ enabled: event.target.checked })}
              />
              {t('notifications.enabled')}
            </label>
            <label>
              {t('notifications.weekday')}
              <select
                value={preferences.weekday}
                onChange={(event) => edit({ weekday: Number(event.target.value) })}
              >
                {([0, 1, 2, 3, 4, 5, 6] as const).map((day) => (
                  <option key={day} value={day}>
                    {t(`notifications.days.${day}`)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('notifications.language')}
              <select
                value={preferences.emailLanguage}
                onChange={(event) => edit({ emailLanguage: event.target.value as 'en' | 'es' })}
              >
                <option value="en">English</option>
                <option value="es">Español</option>
              </select>
            </label>
            <p>{t('notifications.schedule')}</p>
            <button className="button primary">
              {t(saving ? 'notifications.saving' : 'notifications.save')}
            </button>
          </fieldset>
          {saved && <p role="status">{t('notifications.saved')}</p>}
        </>
      )}
    </form>
  );
}
