'use client';

import type { ReactNode } from 'react';
import { GarageProvider } from './garage-provider';
import { LocaleProvider } from './locale-provider';
import { GarageContent } from './garage-content';
import { InteractionProvider } from './interaction-provider';

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
