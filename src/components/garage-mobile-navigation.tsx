'use client';

import { useTranslations } from 'next-intl';
import { navigation, type Page } from './garage-navigation';

export function GarageMobileNavigation({
  page,
  onNavigate,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
}) {
  const t = useTranslations();
  return (
    <nav className="mobile-tabs" aria-label={t('app.mobileNavigation')}>
      {navigation.map(({ id, icon: Icon }) => (
        <button key={id} className={page === id ? 'active' : ''} onClick={() => onNavigate(id)}>
          <Icon size={20} />
          <span>{id === 'history' ? t('navigation.historyShort') : t(`navigation.${id}`)}</span>
        </button>
      ))}
    </nav>
  );
}
