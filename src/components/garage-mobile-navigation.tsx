'use client';

import Link from 'next/link';
import { workspacePaths } from '@/lib/garage-routes';
import { useTranslations } from 'next-intl';
import { navigation, type Page } from './garage-navigation';

export function GarageMobileNavigation({ page }: { page: Page }) {
  const t = useTranslations();
  return (
    <nav className="mobile-tabs" aria-label={t('app.mobileNavigation')}>
      {navigation.map(({ id, icon: Icon }) => (
        <Link
          key={id}
          className={page === id ? 'active' : ''}
          href={workspacePaths[id]}
          aria-current={page === id ? 'page' : undefined}
        >
          <Icon size={20} />
          <span>{id === 'history' ? t('navigation.historyShort') : t(`navigation.${id}`)}</span>
        </Link>
      ))}
    </nav>
  );
}
