'use client';

import { useTranslations } from 'next-intl';
import { Modal } from './modal';
import { AccountSettingsForm } from './account-settings-form';
import { useGarage } from './garage-provider';

export function AccountSettingsDialog() {
  const t = useTranslations();
  const garage = useGarage();
  if (!garage.user) return null;
  return (
    <Modal
      title={t('account.settings')}
      busy={garage.accountBusy}
      onClose={() => {
        if (!garage.accountBusy) garage.setModal(null);
      }}
    >
      <div className="modal-body form-stack">
        <p>{t('account.currentEmail', { email: garage.user.email ?? '' })}</p>
        {garage.transferring && <p role="status">{t('account.transferBlocked')}</p>}
        {(['email', 'password', 'delete'] as const).map((kind) => (
          <AccountSettingsForm
            key={kind}
            kind={kind}
            disabled={garage.accountBusy || garage.transferring || garage.loading}
          />
        ))}
      </div>
    </Modal>
  );
}
