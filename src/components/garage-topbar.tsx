'use client';

import { useTranslations } from 'next-intl';
import { CalendarDays, Menu } from 'lucide-react';
import { LocaleSelector } from './locale-selector';
import { useDisplay } from '@/i18n/use-display';
import { todayISO } from '@/lib/today-iso';
import type { Page } from './garage-navigation';
import type { RefObject } from 'react';

export function GarageTopbar({
  page,
  menuOpen,
  menuTrigger,
  onMenuToggle,
}: {
  page: Page;
  menuOpen: boolean;
  menuTrigger: RefObject<HTMLButtonElement | null>;
  onMenuToggle: () => void;
}) {
  const t = useTranslations();
  const { displayDate } = useDisplay();
  return (
    <header className="topbar">
      <button
        className="mobile-menu icon-button"
        ref={menuTrigger}
        aria-label={t(menuOpen ? 'app.closeMenu' : 'app.openMenu')}
        aria-expanded={menuOpen}
        aria-controls="garage-sidebar"
        onClick={onMenuToggle}
        onKeyDown={(event) => {
          if (menuOpen && event.key === 'Escape') {
            event.preventDefault();
            onMenuToggle();
          }
        }}
        onBlur={(event) => {
          if (menuOpen && !document.getElementById('garage-sidebar')?.contains(event.relatedTarget))
            onMenuToggle();
        }}
      >
        <Menu size={22} aria-hidden="true" />
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
