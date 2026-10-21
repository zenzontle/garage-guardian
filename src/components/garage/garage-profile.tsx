'use client';

import { useEffect, useRef, useState } from 'react';
import Link from '../interaction/guarded-link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Bell, LogOut, Shield, UserRound, UserRoundPlus } from 'lucide-react';
import { isCloudConfigured } from '@/lib/garage/repository';
import { accountPath } from '@/lib/navigation/garage-routes';
import { useGarage } from './garage-provider';
import { Modal } from '../ui/modal';

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
        <UserRound size={22} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {open && (
        <Modal
          id="garage-profile-drawer"
          variant="drawer"
          title={t('account.settings')}
          onClose={close}
        >
          <nav className="modal-body profile-options" aria-label={t('account.settings')}>
            <Link className="profile-option" href="/settings/account" onClick={close}>
              <UserRound size={19} aria-hidden="true" />
              {t('account.settings')}
            </Link>
            <Link className="profile-option" href="/settings/notifications" onClick={close}>
              <Bell size={19} aria-hidden="true" />
              {t('account.notifications')}
            </Link>
            {isCloudConfigured ? (
              <Link className="profile-option" href="/settings/security" onClick={close}>
                <Shield size={19} aria-hidden="true" />
                {t('account.security')}
              </Link>
            ) : (
              <button type="button" className="profile-option" disabled>
                <Shield size={19} aria-hidden="true" />
                {t('account.security')}
              </button>
            )}
            {garage.user ? (
              <button
                type="button"
                className="profile-option profile-signout"
                disabled={garage.accountBusy}
                onClick={() => {
                  garage.signOut(close);
                }}
              >
                <LogOut size={19} aria-hidden="true" />
                {t('account.signOut')}
              </button>
            ) : isCloudConfigured ? (
              <Link
                className="profile-option"
                href={accountPath('signup', pathname)}
                onClick={close}
              >
                <UserRoundPlus size={19} aria-hidden="true" />
                {t('account.create')}
              </Link>
            ) : null}
          </nav>
        </Modal>
      )}
    </>
  );
}
