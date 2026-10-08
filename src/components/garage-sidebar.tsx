'use client';

import Link from 'next/link';
import { workspacePaths } from '@/lib/garage-routes';
import { useTranslations } from 'next-intl';
import { CarFront } from 'lucide-react';
import { isCloudConfigured } from '@/lib/repository';
import { GarageLogo } from './garage-logo';
import { navigation, type Page } from './garage-navigation';

export function GarageSidebar({
  page,
  menuOpen,
  onNavigate,
  carCount,
  user,
}: {
  page: Page;
  menuOpen: boolean;
  onNavigate: () => void;
  carCount: number;
  user: { email?: string } | null;
}) {
  const t = useTranslations();
  return (
    <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
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
            <small>{user ? t('app.cloudStorage') : t('app.localStorage')}</small>
          </span>
        </div>
      </div>
    </aside>
  );
}
