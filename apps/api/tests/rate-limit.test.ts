import { randomBytes } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createMemoryRateLimiter,
  createRedisRateLimiter,
  createResilientRateLimiter,
  type RateLimiter,
} from '../src/core/rate-limit';
import { createLogger } from '../src/core/logger';

const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379';
const redis = new Redis(TEST_REDIS_URL, { maxRetriesPerRequest: 1 });
const prefix = `test:${randomBytes(6).toString('hex')}:`;

afterAll(async () => {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const rule = { limit: 3, windowMs: 60_000 };

describe.each<[string, () => RateLimiter]>([
  ['memory', () => createMemoryRateLimiter()],
  ['redis', () => createRedisRateLimiter(redis, prefix)],
])('%s rate limiter', (_name, create) => {
  const limiter = create();
  const key = () => `k:${randomBytes(6).toString('hex')}`;

  it('allows up to the limit, then refuses', async () => {
    const k = key();
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await limiter.hit(k, rule));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
    expect(results.at(-1)!.count).toBe(5);
    expect(results.at(-1)!.retryAfterMs).toBeGreaterThan(0);
    expect(results.at(-1)!.retryAfterMs).toBeLessThanOrEqual(rule.windowMs);
  });

  it('peek reads without counting', async () => {
    const k = key();
    expect(await limiter.peek(k, rule)).toMatchObject({ allowed: true, count: 0 });
    await limiter.hit(k, rule);
    await limiter.hit(k, rule);
    expect((await limiter.peek(k, rule)).allowed).toBe(true);
    await limiter.hit(k, rule);
    expect(await limiter.peek(k, rule)).toMatchObject({ allowed: false, count: 3 });
    expect((await limiter.peek(k, rule)).count).toBe(3);
  });

  it('reset clears the key', async () => {
    const k = key();
    for (let i = 0; i < 4; i++) await limiter.hit(k, rule);
    await limiter.reset(k);
    expect((await limiter.hit(k, rule)).allowed).toBe(true);
  });

  it('opens a new window after the old one ends', async () => {
    const k = key();
    const short = { limit: 1, windowMs: 150 };
    expect((await limiter.hit(k, short)).allowed).toBe(true);
    expect((await limiter.hit(k, short)).allowed).toBe(false);
    await sleep(220);
    expect((await limiter.hit(k, short)).allowed).toBe(true);
  });

  it('counts exactly under concurrency', async () => {
    const k = key();
    const results = await Promise.all(
      Array.from({ length: 50 }, () => limiter.hit(k, { limit: 20, windowMs: 60_000 })),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(20);
  });

  it('keeps keys separate', async () => {
    const [k1, k2] = [key(), key()];
    for (let i = 0; i < 4; i++) await limiter.hit(k1, rule);
    expect((await limiter.hit(k2, rule)).allowed).toBe(true);
  });
});

describe('resilient rate limiter', () => {
  it('still limits when the store is down', async () => {
    const dead = new Redis('redis://127.0.0.1:1', {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    dead.on('error', () => {});
    const limiter = createResilientRateLimiter(
      createRedisRateLimiter(dead),
      createMemoryRateLimiter(),
      createLogger({ NODE_ENV: 'test', LOG_LEVEL: 'silent', INSTANCE_ID: undefined }),
    );
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await limiter.hit('k', rule));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
    await expect(limiter.reset('k')).resolves.toBeUndefined();
    dead.disconnect();
  });
});
