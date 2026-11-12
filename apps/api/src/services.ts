import type { Env } from './config/env';
import { createTokenService } from './core/auth/tokens';
import type { Logger } from './core/logger';
import type { Limits, RateLimiter } from './core/rate-limit';
import type { Database } from './db/client';
import { createAdminService } from './modules/admin/service';
import { createAuthService } from './modules/auth/service';
import { createAttendanceService } from './modules/hr/attendance.service';
import { createCalendarService } from './modules/hr/calendar.service';
import { createEmployeesService } from './modules/hr/employees.service';
import { createLeaveService } from './modules/hr/leave.service';
import { createPurchaseService } from './modules/purchase/purchase.service';
import { createStoreService } from './modules/store/store.service';
import { createOrgService } from './modules/org/service';

export interface ServiceDeps {
  env: Env;
  db: Database;
  logger: Logger;
  limiter: RateLimiter;
  limits: Limits;
  refreshGraceMs?: number;
  /** Test seam: the clock HR rules use. */
  now?: () => Date;
}

/** Builds every service once at boot. Resolvers and routes only ever call these. */
export function createServices({
  env,
  db,
  logger,
  limiter,
  limits,
  refreshGraceMs,
  now,
}: ServiceDeps) {
  const tokens = createTokenService(env.JWT_SECRET);
  return {
    tokens,
    auth: createAuthService({ db, logger, tokens, limiter, limits, refreshGraceMs }),
    org: createOrgService({ db, logger, limiter, limits }),
    admin: createAdminService({ db, logger }),
    employees: createEmployeesService({ db, logger }),
    attendance: createAttendanceService({ db, logger, now }),
    calendar: createCalendarService({ db, logger, now }),
    leave: createLeaveService({ db, logger, now }),
    store: createStoreService({ db, logger, limiter, limits }),
    purchase: createPurchaseService({ db, logger, limiter, limits }),
  };
}

export type Services = ReturnType<typeof createServices>;
