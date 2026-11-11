import type { Redis } from 'ioredis';
import type { LimitRule, RateLimiter } from './types';

// INCR and the first PEXPIRE must be one atomic step, or a crash between them
// leaves a counter that never expires and locks the key forever.
const HIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {count, ttl}
`;

const PEEK_SCRIPT = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`;

/** Shared limiter: counts are the same on every API instance. */
export function createRedisRateLimiter(redis: Redis, prefix = 'rl:'): RateLimiter {
  return {
    async hit(key: string, rule: LimitRule) {
      const [count, ttl] = (await redis.eval(HIT_SCRIPT, 1, prefix + key, rule.windowMs)) as [
        number,
        number,
      ];
      return { allowed: count <= rule.limit, count, retryAfterMs: Math.max(0, ttl) };
    },
    async peek(key: string, rule: LimitRule) {
      const [count, ttl] = (await redis.eval(PEEK_SCRIPT, 1, prefix + key)) as [number, number];
      return { allowed: count < rule.limit, count, retryAfterMs: Math.max(0, ttl) };
    },
    async reset(key: string) {
      await redis.del(prefix + key);
    },
  };
}
