'use client';

import type { ReactNode } from 'react';
import { GarageProvider } from './garage-provider';
import { LocaleProvider } from '../i18n/locale-provider';
import { GarageContent } from './garage-content';
import { InteractionProvider } from '../interaction/interaction-provider';

export function GarageApp({ children }: { children: ReactNode }) {
  return (
    <LocaleProvider>
      <InteractionProvider>
        <GarageProvider>
          <GarageContent>{children}</GarageContent>
        </GarageProvider>
      </InteractionProvider>
    </LocaleProvider>
  );
}
