import type { LimitResult, LimitRule, RateLimiter } from './types';

interface Entry {
  count: number;
  resetAt: number;
}

const MAX_KEYS = 50_000;

/**
 * Per-process limiter. Used in tests and as the fallback when Redis is down;
 * with several API instances each one counts separately.
 */
export function createMemoryRateLimiter(now: () => number = Date.now): RateLimiter {
  const entries = new Map<string, Entry>();

  const live = (key: string): Entry | undefined => {
    const entry = entries.get(key);
    if (entry && entry.resetAt <= now()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  };

  const prune = () => {
    const t = now();
    for (const [key, entry] of entries) if (entry.resetAt <= t) entries.delete(key);
    // Still full of live keys: drop the oldest so memory stays bounded under a flood.
    for (const key of entries.keys()) {
      if (entries.size < MAX_KEYS) break;
      entries.delete(key);
    }
  };

  const result = (entry: Entry | undefined, allowed: boolean): LimitResult => ({
    allowed,
    count: entry?.count ?? 0,
    retryAfterMs: entry ? Math.max(0, entry.resetAt - now()) : 0,
  });

  return {
    async hit(key: string, rule: LimitRule) {
      let entry = live(key);
      if (!entry) {
        if (entries.size >= MAX_KEYS) prune();
        entry = { count: 0, resetAt: now() + rule.windowMs };
        entries.set(key, entry);
      }
      entry.count += 1;
      return result(entry, entry.count <= rule.limit);
    },
    async peek(key: string, rule: LimitRule) {
      const entry = live(key);
      return result(entry, (entry?.count ?? 0) < rule.limit);
    },
    async reset(key: string) {
      entries.delete(key);
    },
  };
}
