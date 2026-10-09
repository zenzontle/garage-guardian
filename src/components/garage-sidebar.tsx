'use client';

import Link from 'next/link';
import { workspacePaths } from '@/lib/garage-routes';
import { useTranslations } from 'next-intl';
import { CarFront } from 'lucide-react';
import { isCloudConfigured } from '@/lib/repository';
import { GarageLogo } from './garage-logo';
import { navigation, type Page } from './garage-navigation';
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

export function GarageSidebar({
  page,
  menuOpen,
  onNavigate,
  menuTrigger,
  carCount,
  user,
}: {
  page: Page;
  menuOpen: boolean;
  onNavigate: () => void;
  menuTrigger: RefObject<HTMLButtonElement | null>;
  carCount: number;
  user: { email?: string } | null;
}) {
  const t = useTranslations();
  const sidebar = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (!menuOpen) return;
    const mobile = window.matchMedia?.('(max-width: 720px)');
    const element = sidebar.current;
    const trigger = menuTrigger.current;
    if (mobile?.matches)
      element?.querySelector<HTMLAnchorElement>('a[aria-current="page"]')?.focus();
    return () => {
      if (mobile?.matches && element?.contains(document.activeElement)) trigger?.focus();
    };
  }, [menuOpen, menuTrigger]);
  useEffect(() => {
    const mobile = window.matchMedia?.('(max-width: 720px)');
    if (!mobile) return;
    const handleResize = () => {
      if (!mobile.matches) onNavigate();
    };
    mobile.addEventListener('change', handleResize);
    return () => mobile.removeEventListener('change', handleResize);
  }, [onNavigate]);
  return (
    <aside
      id="garage-sidebar"
      ref={sidebar}
      className={`sidebar ${menuOpen ? 'open' : ''}`}
      onKeyDown={(event) => {
        if (menuOpen && event.key === 'Escape') {
          event.preventDefault();
          onNavigate();
          menuTrigger.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (
          menuOpen &&
          !event.currentTarget.contains(event.relatedTarget) &&
          event.relatedTarget !== menuTrigger.current
        )
          onNavigate();
      }}
    >
      <div className="brand">
        <div className="brand-mark">
          <GarageLogo />
        </div>
        <div>
          <strong>Garage Guardian</strong>
          <small>{t('app.tagline')}</small>
        </div>
      </div>
      <div className="sidebar-label">{t('app.workspace')}</div>
      <nav aria-label={t('app.mainNavigation')}>
        {navigation.map(({ id, icon: Icon }) => (
          <Link
            key={id}
            className={`nav-link ${page === id ? 'active' : ''}`}
            href={workspacePaths[id]}
            onClick={onNavigate}
            aria-current={page === id ? 'page' : undefined}
          >
            <Icon size={19} />
            <span>{t(`navigation.${id}`)}</span>
            {page === id && <span className="nav-indicator" />}
          </Link>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-summary">
          <span className="summary-icon">
            <CarFront size={18} />
          </span>
          <div>
            <strong>{t('app.vehicleCount', { count: carCount })}</strong>
            <small>{t('app.inGarage')}</small>
          </div>
        </div>
        <div className="account-line">
          <span className="avatar">{user?.email ? user.email[0].toUpperCase() : 'G'}</span>
          <span className="account-text">
            <strong>
              {user?.email || (isCloudConfigured ? t('app.guest') : t('app.prototype'))}
            </strong>
            {!user && <small>{t('app.localStorage')}</small>}
          </span>
        </div>
      </div>
    </aside>
  );
}
