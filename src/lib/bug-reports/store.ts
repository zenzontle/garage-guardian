import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { ReportError, identifier, type ReportConfig } from './server-config';
import { GITHUB_ASSET_URL, REPORT_LIMITS, SUBMISSION_RETENTION_MS, isRepositoryIssueUrl } from './shared';

const receiptSchema = z.strictObject({
  hash: z.string().min(1).max(128), state: z.enum(['uploading', 'creating', 'unknown', 'failed', 'succeeded']),
  assets: z.array(z.string().max(REPORT_LIMITS.assetUrl).regex(GITHUB_ASSET_URL)).max(2), issueUrl: z.string().regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/).optional(), createdAt: z.number().int().nonnegative(),
});
export type Receipt = z.infer<typeof receiptSchema>;
export const RECEIPT_TTL = SUBMISSION_RETENTION_MS / 1000;
// Outlive both routes' 60-second execution limits, but allow recovery.
export const LOCK_TTL = 120;
export function reportStore(config: ReportConfig) {
  const redis = new Redis({ url: config.redisUrl, token: config.redisToken, retry: false });
  const limiter = (name: string, count: number, duration: '10 m' | '1 d' | '1 m') => new Ratelimit({
    redis, limiter: Ratelimit.slidingWindow(count, duration), prefix: `${config.prefix}:${name}`, analytics: false, timeout: 3000,
  });
  const userShort = limiter('user-short', 3, '10 m'), userDaily = limiter('user-daily', 10, '1 d');
  const ipShort = limiter('ip-short', 10, '10 m'), ipDaily = limiter('ip-daily', 50, '1 d');
  const processingUserShort = limiter('processing-user-short', 3, '10 m'), processingUserDaily = limiter('processing-user-daily', 10, '1 d');
  const processingIpShort = limiter('processing-ip-short', 10, '10 m'), processingIpDaily = limiter('processing-ip-daily', 50, '1 d');
  const controls = limiter('controls', 30, '1 m');
  async function check(limits: { limiter: Ratelimit; key: string }[]) {
    const results = await Promise.all(limits.map(async ({ limiter: limit, key }) => {
      const result = await limit.limit(key);
      if (result.reason === 'timeout') throw new ReportError(503, 'LIMITER_UNAVAILABLE', 'Bug reporting is temporarily unavailable. Try again later.');
      await result.pending;
      return result;
    })).catch(() => { throw new ReportError(503, 'LIMITER_UNAVAILABLE', 'Bug reporting is temporarily unavailable. Try again later.'); });
    const denied = results.filter((result) => !result.success);
    if (denied.length) throw new ReportError(429, 'RATE_LIMITED', 'Too many reports. Please try again later.', Math.max(1, Math.ceil((Math.max(...denied.map((result) => result.reset)) - Date.now()) / 1000)));
  }
  const receiptKey = (userId: string, submissionId: string) => `${config.prefix}:receipt:${identifier(config, 'user', userId)}:${submissionId}`;
  return {
    async processing(userId: string, ip: string) {
      const user = identifier(config, 'user', userId), address = identifier(config, 'ip', ip);
      await check([{ limiter: processingUserShort, key: user }, { limiter: processingUserDaily, key: user }, { limiter: processingIpShort, key: address }, { limiter: processingIpDaily, key: address }]);
    },
    async limit(userId: string, ip: string) {
      const user = identifier(config, 'user', userId), address = identifier(config, 'ip', ip);
      await check([{ limiter: userShort, key: user }, { limiter: userDaily, key: user }, { limiter: ipShort, key: address }, { limiter: ipDaily, key: address }]);
    },
    async control(userId: string) { await check([{ limiter: controls, key: identifier(config, 'user', userId) }]); },
    async get(userId: string, submissionId: string): Promise<Receipt | null> {
      const value = await redis.get(receiptKey(userId, submissionId));
      if (value === null) return null;
      const receipt = receiptSchema.parse(value);
      if (receipt.issueUrl && !isRepositoryIssueUrl(receipt.issueUrl, config.repository)) throw new ReportError(503, 'INVALID_RECEIPT', 'Submission status is unavailable.');
      return receipt;
    },
    async claim(userId: string, submissionId: string, receipt: Receipt): Promise<boolean> {
      return (await redis.set(receiptKey(userId, submissionId), receipt, { nx: true, ex: RECEIPT_TTL })) === 'OK';
    },
    async save(userId: string, submissionId: string, receipt: Receipt) {
      // Keep the original expiry: updates must not extend the retry safety window.
      const ttl = Math.max(1, RECEIPT_TTL - Math.floor((Date.now() - receipt.createdAt) / 1000));
      await redis.set(receiptKey(userId, submissionId), receipt, { ex: ttl });
    },
    async lock(userId: string, submissionId: string): Promise<string | null> {
      const token = randomUUID();
      return (await redis.set(`${receiptKey(userId, submissionId)}:lock`, token, { nx: true, ex: LOCK_TTL })) === 'OK' ? token : null;
    },
    async unlock(userId: string, submissionId: string, token: string) {
      // An expired owner must not release a newer invocation's lease.
      await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", [`${receiptKey(userId, submissionId)}:lock`], [token]);
    },
  };
}
export type ReportStore = ReturnType<typeof reportStore>;
