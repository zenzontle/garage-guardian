import en from '../../messages/en.json';
import es from '../../messages/es.json';

export type Locale = 'en' | 'es';
export const LOCALE_KEY = 'garage-guardian:locale';
export const isLocale = (value: unknown): value is Locale => value === 'en' || value === 'es';

export function resolveLocale(saved: unknown, languages: readonly string[]): Locale {
  if (isLocale(saved)) return saved;
  for (const language of languages) {
    const base = language.toLowerCase().split('-')[0];
    if (isLocale(base)) return base;
  }
  return 'en';
}

type Messages = { [key: string]: string | Messages };
export function mergeMessages(defaults: Messages, overrides: Messages): Messages {
  const result = { ...defaults };
  for (const [key, value] of Object.entries(overrides)) {
    const fallback = defaults[key];
    result[key] = typeof value === 'object' && typeof fallback === 'object'
      ? mergeMessages(fallback, value) : value;
  }
  return result;
}

export const messages = { en, es: mergeMessages(en, es) };

declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof en;
  }
}
