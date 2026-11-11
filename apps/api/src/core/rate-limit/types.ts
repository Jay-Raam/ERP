export interface LimitRule {
  /** Hits allowed inside one window. */
  limit: number;
  windowMs: number;
}

export interface LimitResult {
  allowed: boolean;
  count: number;
  /** Time until the window resets. 0 when the key has no window open. */
  retryAfterMs: number;
}

/** Fixed-window counter. Implementations must make `hit` atomic. */
export interface RateLimiter {
  /** Counts one hit. Allowed while count <= limit. */
  hit(key: string, rule: LimitRule): Promise<LimitResult>;
  /** Reads without counting. Allowed while count < limit, i.e. one more hit would pass. */
  peek(key: string, rule: LimitRule): Promise<LimitResult>;
  reset(key: string): Promise<void>;
}
