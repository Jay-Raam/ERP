import type { RequestHandler } from 'express';
import { RateLimitedError } from '../errors/app-error';
import type { LimitRule, RateLimiter } from './types';

export type { LimitResult, LimitRule, RateLimiter } from './types';
export { createMemoryRateLimiter } from './memory';
export { createRedisRateLimiter } from './redis';
export { createResilientRateLimiter } from './resilient';

/** Every limit the API enforces, in one place so tests and deployments can tune them. */
export interface Limits {
  /** All requests from one IP. */
  global: LimitRule;
  /** Sign-in attempts from one IP, right or wrong. */
  loginPerIp: LimitRule;
  /** Failed sign-ins for one email from one IP before that IP is locked out of that email. */
  loginFailures: LimitRule;
  /**
   * Failed sign-ins for one email from anywhere. Much higher than loginFailures so one
   * stranger cannot lock the real owner out with a handful of guesses.
   */
  loginFailuresPerAccount: LimitRule;
  /** New organisations from one IP. */
  registerPerIp: LimitRule;
  /** Token refreshes from one IP. */
  refreshPerIp: LimitRule;
}

const MINUTE = 60_000;

export const DEFAULT_LIMITS: Limits = {
  global: { limit: 300, windowMs: MINUTE },
  loginPerIp: { limit: 30, windowMs: 10 * MINUTE },
  loginFailures: { limit: 5, windowMs: 15 * MINUTE },
  loginFailuresPerAccount: { limit: 40, windowMs: 15 * MINUTE },
  registerPerIp: { limit: 5, windowMs: 60 * MINUTE },
  refreshPerIp: { limit: 60, windowMs: MINUTE },
};

export function retryMessage(what: string, retryAfterMs: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterMs / MINUTE));
  return `${what} Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

/** Throws RATE_LIMITED when the key is over its limit; otherwise counts the hit. */
export async function enforceLimit(
  limiter: RateLimiter,
  key: string,
  rule: LimitRule,
  what = 'Too many requests.',
): Promise<void> {
  const result = await limiter.hit(key, rule);
  if (!result.allowed) throw new RateLimitedError(retryMessage(what, result.retryAfterMs));
}

export function globalRateLimit(limiter: RateLimiter, rule: LimitRule): RequestHandler {
  return (req, res, next) => {
    if (req.path.startsWith('/health')) return next();
    limiter
      .hit(`global:${req.ip}`, rule)
      .then((result) => {
        if (result.allowed) return next();
        res.setHeader('Retry-After', Math.ceil(result.retryAfterMs / 1000));
        next(new RateLimitedError());
      })
      .catch(next);
  };
}
