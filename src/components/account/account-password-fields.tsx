'use client';
import { useTranslations } from 'next-intl';

export function AccountPasswordFields({
  password,
  confirmation,
  onPassword,
  onConfirmation,
}: {
  password: string;
  confirmation: string;
  onPassword: (value: string) => void;
  onConfirmation: (value: string) => void;
}) {
  const t = useTranslations();
  return (
    <>
      <label>
        {t('account.newPassword')}
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          maxLength={1024}
          value={password}
          onChange={(event) => onPassword(event.target.value)}
        />
      </label>
      <label>
        {t('account.confirmPassword')}
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          maxLength={1024}
          value={confirmation}
          onChange={(event) => onConfirmation(event.target.value)}
        />
      </label>
    </>
  );
}
