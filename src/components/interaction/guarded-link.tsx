'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ComponentProps } from 'react';
import { useInteractions } from './interaction-provider';
import { GuardedNavigationLink } from './guarded-navigation-link';

export type GuardedLinkProps = Omit<ComponentProps<typeof Link>, 'href'> & { href: string };
export default function GuardedLink(props: GuardedLinkProps) {
  const interactions = useInteractions();
  return interactions ? <GuardedNavigationLink {...props} /> : <Link {...props} />;
}

export function useGuardedRouter() {
  const router = useRouter();
  const interactions = useInteractions();
  const navigate = (action: () => void) => (interactions ? interactions.request(action) : action());
  return {
    push: (...args: Parameters<typeof router.push>) => navigate(() => router.push(...args)),
    replace: (...args: Parameters<typeof router.replace>) =>
      navigate(() => router.replace(...args)),
  };
}
