'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CURRENCIES, type Currency } from '@/lib/currency/currency';
import { useGarage } from '../garage/garage-provider';
import { useFormInteraction } from '../interaction/use-form-interaction';

export function HomeCurrencyForm() {
  const t = useTranslations();
  const garage = useGarage();
  const [currency, setCurrency] = useState<Currency>(garage.homeCurrency);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const interaction = useFormInteraction({ currency }, { busy, group: 'account-settings' });
  return (
    <form
      className="form-stack account-section"
      aria-busy={busy}
      onSubmit={async (event) => {
        event.preventDefault();
        if (!garage.repository || !interaction.begin()) return;
        setBusy(true);
        setFailed(false);
        try {
          await garage.run(() => garage.repository!.saveHomeCurrency(currency));
          interaction.accept();
        } catch {
          setFailed(true);
        } finally {
          setBusy(false);
          interaction.end();
        }
      }}
    >
      <label>
        {t('currency.home')}
        <select
          value={currency}
          disabled={busy || !garage.repository}
          onChange={(event) => setCurrency(event.target.value as Currency)}
        >
          {CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {code} — {t(`currency.${code}`)}
            </option>
          ))}
        </select>
      </label>
      <p className="section-hint">{t('currency.homeHint')}</p>
      {failed && (
        <p role="alert" className="error-text">
          {t('errors.save')}
        </p>
      )}
      <button
        className="button secondary"
        disabled={busy || !garage.repository || currency === garage.homeCurrency}
      >
        {t(busy ? 'shared.saving' : 'shared.saveChanges')}
      </button>
    </form>
  );
}
