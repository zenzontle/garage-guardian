import { afterEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { installHistoryGuard } from './history-guard';

let uninstall: (() => void) | undefined;
afterEach(() => {
  uninstall?.();
  window.history.replaceState(null, '', '/');
});

it('restores a dirty history traversal before asking and replays it only on discard', async () => {
  window.history.replaceState({ __NA: true, tree: 'original' }, '', '/');
  const blocked = vi.fn(() => false);
  let resume: (() => void) | undefined;
  const request = vi.fn((action: () => void) => {
    resume = action;
  });
  uninstall = installHistoryGuard(blocked, request);
  window.history.pushState({ __NA: true, tree: 'history' }, '', '/history');
  window.history.pushState({ __NA: true, tree: 'reports' }, '', '/reports');
  const committed = vi.fn();
  window.addEventListener('popstate', committed);
  blocked.mockReturnValue(true);
  window.history.back();
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  expect(window.location.pathname).toBe('/reports');
  expect(window.history.state.tree).toBe('reports');
  expect(committed).not.toHaveBeenCalled();
  // Keep editing: do not call resume, then try again.
  window.history.back();
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  expect(window.location.pathname).toBe('/reports');
  resume!();
  await waitFor(() => expect(window.location.pathname).toBe('/history'));
  expect(window.history.state.tree).toBe('history');
  expect(committed).toHaveBeenCalledOnce();
  blocked.mockReturnValue(false);
  window.history.forward();
  await waitFor(() => expect(window.location.pathname).toBe('/reports'));
  window.removeEventListener('popstate', committed);
});

it('preserves Next metadata on replacements and restores the original history methods', () => {
  const push = window.history.pushState;
  const replace = window.history.replaceState;
  uninstall = installHistoryGuard(
    () => false,
    (action) => action(),
  );
  window.history.replaceState({ __NA: true, tree: ['next'], secret: 'untouched' }, '', '/cars');
  expect(window.history.state).toMatchObject({ __NA: true, tree: ['next'], secret: 'untouched' });
  uninstall();
  expect(window.history.pushState).toBe(push);
  expect(window.history.replaceState).toBe(replace);
});

it('does not write stale indices when Next retains an uninstalled wrapper during effect replay', async () => {
  window.history.replaceState(null, '', '/');
  const nativePush = window.history.pushState;
  const nativeReplace = window.history.replaceState;
  const first = installHistoryGuard(
    () => false,
    (action) => action(),
  );
  const capturedPush = window.history.pushState;
  const capturedReplace = window.history.replaceState;
  window.history.pushState = function (...args) {
    capturedPush.apply(this, args);
  };
  window.history.replaceState = function (...args) {
    capturedReplace.apply(this, args);
  };
  first();
  // AppRouter cleanup restores the functions it captured, after the child guard cleaned up.
  window.history.pushState = capturedPush;
  window.history.replaceState = capturedReplace;
  let resume: (() => void) | undefined;
  let dirty = false;
  uninstall = installHistoryGuard(
    () => dirty,
    (action) => {
      resume = action;
    },
  );
  try {
    window.history.pushState({ __NA: true }, '', '/a');
    window.history.pushState({ __NA: true }, '', '/b');
    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe('/a'));
    window.history.pushState({ __NA: true }, '', '/c');
    expect(window.history.state.__garageHistoryIndex).toBe(2);
    dirty = true;
    window.history.back();
    await waitFor(() => expect(resume).toBeTypeOf('function'));
    expect(window.location.pathname).toBe('/c');
    resume!();
    await waitFor(() => expect(window.location.pathname).toBe('/a'));
  } finally {
    uninstall();
    window.history.pushState = nativePush;
    window.history.replaceState = nativeReplace;
  }
});
