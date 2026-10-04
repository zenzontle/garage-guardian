import type { BugReport, PublicMetadata } from './shared';
import type { ReportConfig } from './server-config';
import type { Receipt, ReportStore } from './store';

export const metadata: PublicMetadata = { release: '0.1.0+test', environment: 'preview', repository: 'zenzontle/garage-guardian', reporterId: `reporter-${'a'.repeat(24)}`, browserOS: 'Test browser / OS' };
export function report(): BugReport { return { submissionId: 'b3a37ad0-6f5a-4ca8-96e1-499b169767df', title: 'Broken car dialog', description: 'Steps: open dialog. Expected: readable. Actual: clipped.', acknowledged: true, metadata,
  context: { pathname: '/', screen: 'cars', dialog: 'add-car', viewport: { width: 390, height: 844, pixelRatio: 2 }, locale: 'en-US', online: true }, diagnostics: [] }; }
export const config: ReportConfig = { repository: metadata.repository, environment: 'preview', release: metadata.release, githubToken: 'test-github-token', secret: 'x'.repeat(32), redisUrl: 'https://test.upstash.io', redisToken: 'test-redis', supabaseUrl: 'https://test.supabase.co', supabaseKey: 'test-key', prefix: 'test:preview' };
export function memoryStore(): ReportStore {
  const receipts = new Map<string, Receipt>();
  const locks = new Set<string>();
  return {
    limit: async () => {}, control: async () => {},
    get: async (user, id) => structuredClone(receipts.get(`${user}:${id}`) ?? null),
    claim: async (user, id, value) => { const key = `${user}:${id}`; if (receipts.has(key)) return false; receipts.set(key, structuredClone(value)); return true; },
    save: async (user, id, value) => { receipts.set(`${user}:${id}`, structuredClone(value)); },
    lock: async (user, id) => { const key = `${user}:${id}`; if (locks.has(key)) return false; locks.add(key); return true; },
    unlock: async (user, id) => { locks.delete(`${user}:${id}`); },
  };
}
