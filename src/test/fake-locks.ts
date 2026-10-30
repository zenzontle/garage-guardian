import { vi } from 'vitest';

// Web Locks stand-in: requests for the same name run one at a time, and a test
// can hold the next request whose name starts with a prefix.
export function fakeLocks() {
  const tails = new Map<string, Promise<unknown>>();
  type Hold = { prefix: string; requested: () => void; wait: Promise<void>; settled: () => void };
  const holds: Hold[] = [];
  const request = vi.fn((name: string, work: () => Promise<unknown>) => {
    const index = holds.findIndex((hold) => name.startsWith(hold.prefix));
    const hold = index < 0 ? undefined : holds.splice(index, 1)[0];
    hold?.requested();
    const pending = (tails.get(name) ?? Promise.resolve()).then(async () => {
      await hold?.wait;
      try {
        return await work();
      } finally {
        hold?.settled();
      }
    });
    tails.set(
      name,
      pending.then(
        () => undefined,
        () => undefined,
      ),
    );
    return pending;
  });
  // Add only Web Locks; the rest of jsdom's navigator stays intact.
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
  return {
    request,
    hold(prefix: string) {
      let settled!: () => void;
      const state = {
        requested: false,
        release: () => {},
        // Resolves once the held work has run, whether it succeeded or failed.
        finished: new Promise<void>((resolve) => {
          settled = resolve;
        }),
      };
      const wait = new Promise<void>((resolve) => {
        state.release = resolve;
      });
      holds.push({ prefix, wait, settled, requested: () => (state.requested = true) });
      return state;
    },
  };
}
