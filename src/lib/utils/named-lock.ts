const operations = new Map<string, Promise<unknown>>();

// Runs one action at a time per name: queued within this tab, and across tabs
// through Web Locks where the browser supports them.
export async function withNamedLock<T>(name: string, action: () => Promise<T>): Promise<T> {
  const previous = operations.get(name);
  const work = (async () => {
    await previous?.catch(() => {});
    if (typeof navigator !== 'undefined' && navigator.locks)
      return navigator.locks.request(name, action);
    return action();
  })();
  operations.set(name, work);
  try {
    return await work;
  } finally {
    if (operations.get(name) === work) operations.delete(name);
  }
}
