'use client';

import { useTranslations } from 'next-intl';
import { CalendarDays, Menu } from 'lucide-react';
import { LocaleSelector } from '../i18n/locale-selector';
import { useDisplay } from '@/i18n/use-display';
import { todayISO } from '@/lib/utils/today-iso';
import type { Page } from './garage-navigation';
import type { RefObject } from 'react';
import { GarageProfile } from './garage-profile';

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
        <span className="breadcrumbs-home">{t('app.yourGarage')}</span>
        <span className="breadcrumbs-divider">/</span>{' '}
        <strong>
          {t(
            page === 'notifications'
              ? 'notifications.pageTitle'
              : page === 'account'
                ? 'account.settings'
                : page === 'security'
                  ? 'account.security'
                  : `navigation.${page}`,
          )}
        </strong>
      </span>
      <div className="topbar-right">
        <LocaleSelector />
        <span className="today-pill">
          <CalendarDays size={15} />
          {displayDate(todayISO())}
        </span>
        <GarageProfile />
      </div>
    </header>
  );
}
