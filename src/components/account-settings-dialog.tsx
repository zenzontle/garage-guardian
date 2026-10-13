'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Modal } from './modal';
import { AccountSettingsForm } from './account-settings-form';
import { useGarage } from './garage-provider';
import { NotificationPreferencesForm } from './notification-preferences-form';

export function AccountSettingsDialog({ section }: { section?: 'security' }) {
  const t = useTranslations();
  const garage = useGarage();
  const notificationsHeadingId = useId();
  const securityHeadingId = useId();
  const [notificationBusy, setNotificationBusy] = useState(false);
  if (!garage.user) return null;
  return (
    <Modal
      title={t(section === 'security' ? 'account.security' : 'account.settings')}
      busy={garage.accountBusy || notificationBusy}
      onClose={() => {
        if (!garage.accountBusy && !notificationBusy) garage.setModal(null);
      }}
    >
      <div className="modal-body form-stack">
        <p>{t('account.currentEmail', { email: garage.user.email ?? '' })}</p>
        {garage.transferring && <p role="status">{t('account.transferBlocked')}</p>}
        {section !== 'security' && (
          <section
            className="form-stack account-section account-settings-section"
            aria-labelledby={notificationsHeadingId}
          >
            <h3 id={notificationsHeadingId}>{t('account.notifications')}</h3>
            <NotificationPreferencesForm
              userId={garage.user.id}
              onBusyChange={setNotificationBusy}
              disabled={garage.accountBusy || garage.transferring || garage.loading}
              headingLevel={4}
            />
          </section>
        )}
        <section
          className="form-stack account-section account-settings-section"
          aria-labelledby={securityHeadingId}
        >
          <h3 id={securityHeadingId}>{t('account.security')}</h3>
          {(['email', 'password'] as const).map((kind) => (
            <AccountSettingsForm
              key={kind}
              kind={kind}
              disabled={
                garage.accountBusy || notificationBusy || garage.transferring || garage.loading
              }
              headingLevel={4}
            />
          ))}
        </section>
      </div>
    </Modal>
  );
}
