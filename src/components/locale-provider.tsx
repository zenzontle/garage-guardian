'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import { isLocale, LOCALE_KEY, messages, resolveLocale, type Locale } from '@/i18n/config';

const LocaleContext = createContext<{
  locale: Locale;
  selectLocale: (locale: Locale) => void;
} | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>('en');
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(LOCALE_KEY);
    } catch {
      /* Storage is optional. */
    }
    setLocale(
      resolveLocale(
        saved,
        navigator.languages?.length ? navigator.languages : [navigator.language],
      ),
    );
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  function selectLocale(next: Locale) {
    setLocale(next);
    try {
      localStorage.setItem(LOCALE_KEY, next);
    } catch {
      /* Keep the session choice. */
    }
  }

  return (
    <LocaleContext.Provider value={{ locale, selectLocale }}>
      <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="UTC">
        {children}
      </NextIntlClientProvider>
    </LocaleContext.Provider>
  );
}

export function LocaleSelector() {
  const context = useContext(LocaleContext);
  const t = useTranslations('shared');
  if (!context) throw new Error('LocaleSelector requires LocaleProvider');
  return (
    <label className="locale-selector">
      <span className="sr-only">{t('language')}</span>
      <select
        value={context.locale}
        onChange={(event) => {
          if (isLocale(event.target.value)) context.selectLocale(event.target.value);
        }}
      >
        <option value="en" lang="en">
          English
        </option>
        <option value="es" lang="es">
          Español
        </option>
      </select>
    </label>
  );
}
