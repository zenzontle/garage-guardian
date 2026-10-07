'use client';

import { LocaleProvider } from './locale-provider';
import { GarageContent } from './garage-content';

export function GarageApp() {
  return (
    <LocaleProvider>
      <GarageContent />
    </LocaleProvider>
  );
}
