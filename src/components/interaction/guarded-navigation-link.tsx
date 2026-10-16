'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useInteractions } from './interaction-provider';
import type { GuardedLinkProps } from './guarded-link';

export function GuardedNavigationLink({ onNavigate, ...props }: GuardedLinkProps) {
  const interactions = useInteractions()!;
  const router = useRouter();
  return (
    <Link
      {...props}
      onNavigate={(event) => {
        let prevented = false;
        onNavigate?.({
          preventDefault: () => {
            prevented = true;
            event.preventDefault();
          },
        });
        if (prevented) return;
        event.preventDefault();
        interactions.request(() => {
          if (props.replace) router.replace(props.href, { scroll: props.scroll });
          else router.push(props.href, { scroll: props.scroll });
        });
      }}
    />
  );
}
