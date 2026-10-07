'use client';

import { useTranslations } from 'next-intl';
import { CalendarDays, Menu } from 'lucide-react';
import { LocaleSelector } from './locale-selector';
import { useDisplay } from '@/i18n/use-display';
import { todayISO } from '@/lib/today-iso';
import type { Page } from './garage-navigation';

export function GarageTopbar({ page, onMenuToggle }: { page: Page; onMenuToggle: () => void }) {
  const t = useTranslations();
  const { displayDate } = useDisplay();
  return (
    <header className="topbar">
      <button
        className="mobile-menu icon-button"
        aria-label={t('app.openMenu')}
        onClick={onMenuToggle}
      >
        <Menu size={22} />
      </button>
      <span className="breadcrumbs">
        {t('app.yourGarage')}
        <span>/</span> <strong>{t(`navigation.${page}`)}</strong>
      </span>
      <span className="topbar-right">
        <LocaleSelector />
        <span className="today-pill">
          <CalendarDays size={15} />
          {displayDate(todayISO())}
        </span>
      </span>
    </header>
  );
}
