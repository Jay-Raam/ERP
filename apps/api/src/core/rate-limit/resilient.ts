import type { Logger } from '../logger';
import type { RateLimiter } from './types';

const WARN_EVERY_MS = 30_000;

/**
 * Uses the primary limiter (Redis) and falls back to the local one when it
 * fails. Failing open would switch brute-force protection off; failing closed
 * would let a Redis outage lock everyone out. A per-instance limit is the
 * middle ground.
 */
export function createResilientRateLimiter(
  primary: RateLimiter,
  fallback: RateLimiter,
  logger: Logger,
): RateLimiter {
  let lastWarned = 0;

  const guard = async <T>(run: (limiter: RateLimiter) => Promise<T>): Promise<T> => {
    try {
      return await run(primary);
    } catch (error) {
      if (Date.now() - lastWarned > WARN_EVERY_MS) {
        lastWarned = Date.now();
        logger.warn({ err: error }, 'rate limiter store unavailable; using in-memory fallback');
      }
      return run(fallback);
    }
  };

  return {
    hit: (key, rule) => guard((l) => l.hit(key, rule)),
    peek: (key, rule) => guard((l) => l.peek(key, rule)),
    reset: (key) => guard((l) => l.reset(key)),
  };
}
