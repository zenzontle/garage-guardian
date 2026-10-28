'use client';

import { useEffect, useRef, useState } from 'react';
import type { Visit } from '../garage/model';
import {
  automaticConversion,
  parseCents,
  receiptInputs,
  validConversion,
  validDate,
  type Conversion,
  type Currency,
} from './currency';
import { lookupRate } from './rate-client';
import { todayISO } from '../utils/today-iso';

export function useReceiptConversion(
  item: Visit | undefined,
  currency: Currency,
  date: string,
  totalInput: string,
  target: Currency,
) {
  const totalCostCents = parseCents(totalInput);
  const inputs = { currency, date, totalCostCents: totalCostCents ?? -1 };
  const key = JSON.stringify([inputs, target]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const [saved, setSaved] = useState<{ target: Currency; conversion: Conversion | undefined }>({
    target,
    conversion: item?.conversions?.[target],
  });
  const conversion = saved.target === target ? saved.conversion : undefined;
  const [manual, setManual] = useState<{ key: string; input: string } | null>(null);
  const [status, setStatus] = useState<'loading' | 'pending' | 'saved'>('pending');
  const [revision, setRevision] = useState(0);
  const manualRef = useRef(manual);
  manualRef.current = manual;
  const valid = validConversion(conversion, inputs) ? conversion : undefined;
  useEffect(() => {
    if (currency === target || totalCostCents === null || !validDate(date) || date > todayISO())
      return;
    if (valid || manual?.key === key) return;
    let active = true;
    setStatus('loading');
    void lookupRate(currency, target, date)
      .then((rate) => {
        if (active && currentKey.current === key && manualRef.current?.key !== key) {
          setSaved({
            target,
            conversion: automaticConversion({ currency, date, totalCostCents }, rate),
          });
          setStatus('saved');
        }
      })
      .catch(() => {
        if (active && currentKey.current === key) setStatus('pending');
      });
    return () => {
      active = false;
    };
  }, [currency, target, date, totalCostCents, key, valid, manual, revision]);
  const manualInput = manual?.key === key ? manual.input : null;
  return {
    conversion: valid,
    manualInput,
    status: valid ? ('saved' as const) : status,
    value: manualInput ?? (valid ? (valid.convertedCents / 100).toFixed(2) : ''),
    change: (input: string) => {
      setManual({ key, input });
      const cents = input.trim() === '' ? null : parseCents(input);
      setSaved({
        target,
        conversion:
          cents === null || totalCostCents === null
            ? undefined
            : {
                ...receiptInputs({ currency, date, totalCostCents }),
                convertedCents: cents,
                source: 'manual',
                rate: null,
                rateDate: null,
              },
      });
    },
    retry: () => {
      setManual(null);
      setSaved({ target, conversion: undefined });
      setRevision((value) => value + 1);
    },
  };
}
