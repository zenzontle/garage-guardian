'use client';

import { createContext } from 'react';
import type { Locale } from './config';

export const LocaleContext = createContext<{
  locale: Locale;
  selectLocale: (locale: Locale) => void;
} | null>(null);
