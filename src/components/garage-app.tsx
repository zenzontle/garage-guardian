'use client';

import type { ReactNode } from 'react';
import { GarageProvider } from './garage-provider';
import { LocaleProvider } from './locale-provider';
import { GarageContent } from './garage-content';

export function GarageApp({ children }: { children: ReactNode }) {
  return (
    <LocaleProvider>
      <GarageProvider>
        <GarageContent>{children}</GarageContent>
      </GarageProvider>
    </LocaleProvider>
  );
}
