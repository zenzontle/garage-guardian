'use client';

import { cleanDiagnostic, type Diagnostic } from './shared';

let recording = false;
let entries: Diagnostic[] = [];
const MAX_AGE = 5 * 60_000;

function appendDiagnostic(message: string, stack: string, source: Diagnostic['source']) {
  entries = [
    ...recentDiagnostics(),
    cleanDiagnostic({ source, timestamp: Date.now(), message, stack }),
  ].slice(-20);
}

export function recordDiagnostic(cause: unknown, source: Diagnostic['source'] = 'operation') {
  if (!recording) return;
  try {
    // Never inspect/serialize arbitrary objects, including objects with getters.
    const message =
      cause instanceof Error
        ? cause.message
        : typeof cause === 'string'
          ? cause
          : '[Non-text error omitted]';
    const stack = cause instanceof Error ? (cause.stack ?? '') : '';
    appendDiagnostic(message, stack, source);
  } catch {
    /* A malformed Error must not change application behavior. */
  }
}
export function recentDiagnostics(): Diagnostic[] {
  return entries
    .filter((entry) => entry.timestamp >= Date.now() - MAX_AGE)
    .map((entry) => ({ ...entry }));
}
export function clearDiagnostics() {
  entries = [];
}
export function startDiagnostics() {
  recording = true;
  clearDiagnostics();
  const original = console.error;
  let active = true;
  const wrapped: typeof console.error = (...args) => {
    original.apply(console, args);
    if (!active) return;
    try {
      const error = args.find((arg): arg is Error => arg instanceof Error);
      const message = [
        ...args.filter((arg): arg is string => typeof arg === 'string'),
        ...(error ? [error.message] : []),
      ].join(' ');
      appendDiagnostic(message || '[Non-text error omitted]', error?.stack ?? '', 'console');
    } catch {
      /* Preserve console behavior even for unreadable Error properties. */
    }
  };
  console.error = wrapped;
  const onError = (event: ErrorEvent) =>
    recordDiagnostic(event.error instanceof Error ? event.error : event.message, 'browser');
  const onRejection = (event: PromiseRejectionEvent) => recordDiagnostic(event.reason, 'rejection');
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    active = false;
    recording = false;
    clearDiagnostics();
    if (console.error === wrapped) console.error = original;
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
