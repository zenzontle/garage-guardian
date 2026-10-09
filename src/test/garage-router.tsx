import { useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { vi } from 'vitest';

const testRouter = vi.hoisted(() => {
  let entries = ['/'];
  let index = 0;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    get url() {
      return entries[index];
    },
    get entries() {
      return [...entries];
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    push: vi.fn((url: string) => {
      entries = [...entries.slice(0, index + 1), url];
      index++;
      notify();
    }),
    replace: vi.fn((url: string) => {
      entries[index] = url;
      notify();
    }),
    back() {
      if (index > 0) {
        index--;
        notify();
      }
    },
    forward() {
      if (index < entries.length - 1) {
        index++;
        notify();
      }
    },
    reset(url = '/') {
      entries = [url];
      index = 0;
      this.push.mockClear();
      this.replace.mockClear();
      notify();
    },
  };
});

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const useUrl = () => useSyncExternalStore(testRouter.subscribe, () => testRouter.url);
  return {
    useRouter: () => testRouter,
    usePathname: () => new URL(useUrl(), 'http://localhost').pathname,
    useSearchParams: () => new URL(useUrl(), 'http://localhost').searchParams,
  };
});

vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
      createElement(
        'a',
        {
          ...props,
          href,
          onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
            props.onClick?.(event);
            if (
              event.defaultPrevented ||
              event.button !== 0 ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey ||
              event.altKey ||
              props.target === '_blank'
            )
              return;
            event.preventDefault();
            testRouter.push(href!);
          },
        },
        children,
      ),
  };
});

import { TestRoutes, type Screens } from './garage-test-routes';
export function createGarageTestApp(
  Layout: ComponentType<{ children: ReactNode }>,
  screens: Screens,
) {
  return function GarageTestApp() {
    const url = useSyncExternalStore(testRouter.subscribe, () => testRouter.url);
    return (
      <Layout>
        <TestRoutes screens={screens} url={url} />
      </Layout>
    );
  };
}

export async function loadGarageTestApp() {
  const { GarageApp } = await import('@/components/garage-app');
  const modules = await Promise.all([
    import('@/components/dashboard-screen'),
    import('@/components/cars-screen'),
    import('@/components/history-screen'),
    import('@/components/reports-screen'),
    import('@/components/account-screen'),
    import('@/components/account-recovery-screen'),
  ]);
  const screens = Object.assign({}, ...modules) as Screens;
  return createGarageTestApp(GarageApp, screens);
}

export { testRouter };
