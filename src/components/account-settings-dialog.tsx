'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Modal } from './modal';
import { AccountSettingsForm } from './account-settings-form';
import { useGarage } from './garage-provider';
import { NotificationPreferencesForm } from './notification-preferences-form';

export function AccountSettingsDialog() {
  const t = useTranslations();
  const garage = useGarage();
  const [notificationBusy, setNotificationBusy] = useState(false);
  if (!garage.user) return null;
  return (
    <Modal
      title={t('account.settings')}
      busy={garage.accountBusy || notificationBusy}
      onClose={() => {
        if (!garage.accountBusy && !notificationBusy) garage.setModal(null);
      }}
    >
      <div className="modal-body form-stack">
        <p>{t('account.currentEmail', { email: garage.user.email ?? '' })}</p>
        {garage.transferring && <p role="status">{t('account.transferBlocked')}</p>}
        <NotificationPreferencesForm
          userId={garage.user.id}
          onBusyChange={setNotificationBusy}
          disabled={garage.accountBusy || garage.transferring || garage.loading}
        />
        {(['email', 'password'] as const).map((kind) => (
          <AccountSettingsForm
            key={kind}
            kind={kind}
            disabled={
              garage.accountBusy || notificationBusy || garage.transferring || garage.loading
            }
          />
        ))}
      </div>
    </Modal>
  );
}
