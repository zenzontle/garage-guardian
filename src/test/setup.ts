import 'fake-indexeddb/auto';
import { Blob, File } from 'node:buffer';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// IndexedDB uses structured clone; Node's Blob/File support it, jsdom's do not.
Object.assign(globalThis, { Blob, File });
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
