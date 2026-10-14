import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import en from '../../messages/en.json';
import es from '../../messages/es.json';
import { InteractionProvider } from '@/components/interaction-provider';

export function InteractionTestProvider({
  children,
  locale = 'en',
}: {
  children: ReactNode;
  locale?: 'en' | 'es';
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : es}>
      <InteractionProvider>{children}</InteractionProvider>
    </NextIntlClientProvider>
  );
}
