'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { GarageLogo } from './garage-logo';
import { LocaleSelector } from './locale-selector';

export function AccountCard({ children }: { children: ReactNode }) {
  const t = useTranslations();
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
        {children}
      </div>
    </div>
  );
}
