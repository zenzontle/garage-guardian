'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Modal } from '../ui/modal';

// Sign-out removes the account's garage from this device, so receipts that have not
// synced yet are only deleted after the owner confirms it.
export function SignOutDialog({
  count,
  onCancel,
  onConfirm,
}: {
  count: number;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations();
  const descriptionId = useId();
  return (
    <Modal
      title={t('account.signOutUnsyncedTitle')}
      onClose={onCancel}
      role="alertdialog"
      initialFocus=".modal-footer .secondary"
      descriptionId={descriptionId}
    >
      <div className="modal-body">
        <p id={descriptionId}>{t('account.signOutUnsyncedDescription', { count })}</p>
      </div>
      <div className="modal-footer">
        <button type="button" className="button secondary" onClick={onCancel}>
          {t('shared.cancel')}
        </button>
        <button type="button" className="button danger" onClick={onConfirm}>
          {t('account.signOutDiscard')}
        </button>
      </div>
    </Modal>
  );
}
