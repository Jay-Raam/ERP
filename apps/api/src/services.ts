import type { Env } from './config/env';
import { createTokenService } from './core/auth/tokens';
import type { Logger } from './core/logger';
import type { Limits, RateLimiter } from './core/rate-limit';
import type { Database } from './db/client';
import { createAuthService } from './modules/auth/service';
import { createOrgService } from './modules/org/service';

export interface ServiceDeps {
  env: Env;
  db: Database;
  logger: Logger;
  limiter: RateLimiter;
  limits: Limits;
  refreshGraceMs?: number;
}

/** Builds every service once at boot. Resolvers and routes only ever call these. */
export function createServices({ env, db, logger, limiter, limits, refreshGraceMs }: ServiceDeps) {
  const tokens = createTokenService(env.JWT_SECRET);
  return {
    tokens,
    auth: createAuthService({ db, logger, tokens, limiter, limits, refreshGraceMs }),
    org: createOrgService({ db, logger, limiter, limits }),
  };
}

export type Services = ReturnType<typeof createServices>;
