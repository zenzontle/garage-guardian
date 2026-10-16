'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { LOCALE_KEY, messages, resolveLocale, type Locale } from '@/i18n/config';
import { LocaleContext } from '@/i18n/locale-context';

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
