import {
  createHolidayInputSchema,
  hasPermission,
  listHolidaysInputSchema,
  updateHolidayInputSchema,
  workCalendarInputSchema,
  type Viewer,
} from '@erp/shared';
import { requirePermission } from '../../core/auth/guard';
import { ConflictError, ForbiddenError, NotFoundError } from '../../core/errors';
import { parseId } from '../../core/errors/parse-id';
import type { Logger } from '../../core/logger';
import type { Database, TenantTx } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import { withTenant } from '../../db/tenant';
import { localDate } from './attendance.logic';
import { organisationCalendar } from './attendance.repository';
import * as repo from './calendar.repository';

const STALE = 'Someone else changed this record. Reload it and try again.';
const DUPLICATE = 'There is already a holiday on this date';
const MANAGE = 'attendance.holiday.manage';

export interface CalendarDeps {
  db: Database;
  logger: Logger;
  now?: () => Date;
}

/** Weekly off days and organisation holidays: what makes a day a day off. */
export function createCalendarService({ db, logger, now = () => new Date() }: CalendarDeps) {
  const run = <T>(viewer: Viewer, fn: (tx: TenantTx, tenantId: string) => Promise<T>) =>
    withTenant(db, viewer.organisation.id, (tx) => fn(tx, viewer.organisation.id));

  const audit = (viewer: Viewer, action: string, target: Record<string, unknown>) =>
    logger.info(
      { audit: true, actor: viewer.user.id, tenantId: viewer.organisation.id, action, ...target },
      'hr action',
    );

  const duplicate = (error: unknown) => {
    if (isUniqueViolation(error, 'holidays_tenant_date_unique')) {
      return new ConflictError(DUPLICATE, { fieldErrors: { holidayDate: [DUPLICATE] } });
    }
    return error;
  };

  /** Anyone who can see attendance needs to know which days are off, so this is not admin-only. */
  async function calendar(viewer: Viewer, raw: unknown) {
    const canSee = ['attendance.record.view', 'attendance.record.view-own', MANAGE].some((p) =>
      hasPermission(viewer.permissions, p),
    );
    if (!canSee) throw new ForbiddenError();
    const input = listHolidaysInputSchema.parse(raw ?? {});
    return run(viewer, async (tx) => {
      const { timeZone, weeklyOff } = await organisationCalendar(tx);
      const year = input.year ?? Number(localDate(now(), timeZone).slice(0, 4));
      const holidays = await repo.holidaysBetween(tx, `${year}-01-01`, `${year}-12-31`);
      return { timeZone, weeklyOffDays: weeklyOff, year, holidays };
    });
  }

  return {
    calendar,

    async updateWeeklyOff(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, MANAGE);
      const { weeklyOffDays } = workCalendarInputSchema.parse(raw);
      await run(viewer, (tx, tenantId) => repo.setWeeklyOff(tx, tenantId, weeklyOffDays));
      audit(viewer, 'calendar.weekly-off', { weeklyOffDays });
      return calendar(viewer, {});
    },

    async createHoliday(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, MANAGE);
      const input = createHolidayInputSchema.parse(raw);
      try {
        const id = await run(viewer, (tx, tenantId) =>
          repo.insertHoliday(tx, { ...input, tenantId }),
        );
        audit(viewer, 'holiday.create', { holidayId: id });
        return (await run(viewer, (tx) => repo.findHoliday(tx, id)))!;
      } catch (error) {
        throw duplicate(error);
      }
    },

    async updateHoliday(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, MANAGE);
      const id = parseId(rawId);
      const { version, ...values } = updateHolidayInputSchema.parse(raw);
      try {
        await run(viewer, async (tx) => {
          if (!(await repo.findHoliday(tx, id))) throw new NotFoundError('Holiday not found');
          if (!(await repo.updateHoliday(tx, id, version, values))) throw new ConflictError(STALE);
        });
        audit(viewer, 'holiday.update', { holidayId: id });
        return (await run(viewer, (tx) => repo.findHoliday(tx, id)))!;
      } catch (error) {
        throw duplicate(error);
      }
    },

    async deleteHoliday(viewer: Viewer, rawId: unknown) {
      requirePermission(viewer, MANAGE);
      const id = parseId(rawId);
      const removed = await run(viewer, (tx) => repo.deleteHoliday(tx, id));
      if (!removed) throw new NotFoundError('Holiday not found');
      audit(viewer, 'holiday.delete', { holidayId: id });
      return true;
    },
  };
}

export type CalendarService = ReturnType<typeof createCalendarService>;
