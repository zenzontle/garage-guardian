export const workspacePaths = {
  dashboard: '/',
  cars: '/cars',
  history: '/history',
  reports: '/reports',
} as const;

export type WorkspaceScreen = keyof typeof workspacePaths;
export type AccountMode = 'signin' | 'signup';

export function carPath(id: string) {
  return `/cars/${encodeURIComponent(id)}`;
}

export function workspaceScreen(pathname: string): WorkspaceScreen {
  if (pathname === '/cars' || pathname.startsWith('/cars/')) return 'cars';
  if (pathname === '/history') return 'history';
  if (pathname === '/reports') return 'reports';
  return 'dashboard';
}

export function accountMode(pathname: string): AccountMode | null {
  if (pathname === '/signin') return 'signin';
  if (pathname === '/signup') return 'signup';
  return null;
}

export function validatedReturnTo(value: string | null): string {
  if (!value || /[?#\\\s]/.test(value)) return '/';
  if (Object.values(workspacePaths).some((path) => path === value)) return value;
  const match = /^\/cars\/([^/]+)$/.exec(value);
  if (!match) return '/';
  try {
    const id = decodeURIComponent(match[1]);
    const hasControl = Array.from(id).some(
      (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
    );
    if (!id || id === '.' || id === '..' || /[/\\?#\s]/.test(id) || hasControl) return '/';
    return carPath(id);
  } catch {
    return '/';
  }
}

export function accountPath(mode: AccountMode, returnTo: string) {
  return `/${mode}?${new URLSearchParams({ returnTo: validatedReturnTo(returnTo) })}`;
}

export const reportPaths = [
  '/',
  '/cars',
  '/cars/[carId]',
  '/history',
  '/reports',
  '/signin',
  '/signup',
] as const;

// Public reports describe the route, never the vehicle identifier or URL parameters.
export function reportPath(pathname: string): (typeof reportPaths)[number] {
  if (/^\/cars\/[^/]+$/.test(pathname)) return '/cars/[carId]';
  return reportPaths.find((path) => path === pathname) ?? '/';
}
