'use client';

import { useContext } from 'react';
import { useTranslations } from 'next-intl';
import { isLocale } from '@/i18n/config';
import { LocaleContext } from '@/i18n/locale-context';

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
