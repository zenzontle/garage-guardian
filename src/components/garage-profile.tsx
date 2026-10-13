'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Bell, LogOut, Shield, UserRound } from 'lucide-react';
import { accountPath } from '@/lib/garage-routes';
import { isCloudConfigured } from '@/lib/repository';
import { useGarage } from './garage-provider';
import { Modal } from './modal';

export function GarageProfile() {
  const t = useTranslations();
  const garage = useGarage();
  const pathname = usePathname();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function openSettings(section?: 'security') {
    close();
    garage.setModal({ kind: 'account', section });
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="avatar profile-trigger"
        aria-label={t('account.openMenu')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? 'garage-profile-drawer' : undefined}
        onClick={() => setOpen(true)}
      >
        {garage.user?.email?.[0]?.toUpperCase() || 'G'}
      </button>
      {open && (
        <Modal
          id="garage-profile-drawer"
          variant="drawer"
          title={t('account.settings')}
          onClose={close}
        >
          <nav className="modal-body profile-options" aria-label={t('account.settings')}>
            {garage.user ? (
              <button
                type="button"
                className="profile-option"
                disabled={garage.accountBusy}
                onClick={() => openSettings()}
              >
                <UserRound size={19} aria-hidden="true" />
                {t('account.settings')}
              </button>
            ) : isCloudConfigured ? (
              <Link
                className="profile-option"
                href={accountPath('signin', pathname)}
                onClick={close}
              >
                <UserRound size={19} aria-hidden="true" />
                {t('account.settings')}
              </Link>
            ) : (
              <button type="button" className="profile-option" disabled>
                <UserRound size={19} aria-hidden="true" />
                {t('account.settings')}
              </button>
            )}
            <Link className="profile-option" href="/settings/notifications" onClick={close}>
              <Bell size={19} aria-hidden="true" />
              {t('account.notifications')}
            </Link>
            {garage.user ? (
              <button
                type="button"
                className="profile-option"
                disabled={garage.accountBusy}
                onClick={() => openSettings('security')}
              >
                <Shield size={19} aria-hidden="true" />
                {t('account.security')}
              </button>
            ) : isCloudConfigured ? (
              <Link
                className="profile-option"
                href={accountPath('signin', pathname)}
                onClick={close}
              >
                <Shield size={19} aria-hidden="true" />
                {t('account.security')}
              </Link>
            ) : (
              <button type="button" className="profile-option" disabled>
                <Shield size={19} aria-hidden="true" />
                {t('account.security')}
              </button>
            )}
            <button
              type="button"
              className="profile-option profile-signout"
              disabled={!garage.user || garage.accountBusy}
              onClick={() => {
                close();
                void garage.signOut();
              }}
            >
              <LogOut size={19} aria-hidden="true" />
              {t('account.signOut')}
            </button>
          </nav>
        </Modal>
      )}
    </>
  );
}
