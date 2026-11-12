import {
  createLeaveTypeInputSchema,
  daysInclusive,
  decideLeaveInputSchema,
  hasPermission,
  idSchema,
  leaveYearSchema,
  listLeaveInputSchema,
  requestLeaveInputSchema,
  updateLeaveTypeInputSchema,
  type Viewer,
} from '@erp/shared';
import { z } from 'zod';
import { requirePermission } from '../../core/auth/guard';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../core/errors';
import type { Logger } from '../../core/logger';
import type { Database, TenantTx } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import { withTenant } from '../../db/tenant';
import { localDate } from './attendance.logic';
import { organisationZone } from './attendance.repository';
import { ensureHrDefaults } from './defaults.repository';
import * as employeeRepo from './employees.repository';
import * as repo from './leave.repository';
import { inScope, scopeOf, selfScope } from './scope';

const STALE = 'Someone else changed this record. Reload it and try again.';

const balancesInputSchema = z.strictObject({
  employeeId: idSchema.nullish().transform((v) => v ?? undefined),
  year: leaveYearSchema,
});

export interface LeaveBalance {
  leaveType: repo.LeaveTypeRow;
  quota: number;
  used: number;
  pending: number;
  remaining: number;
}

/** Quota minus what is taken (approved) and reserved (pending). Never negative. */
export function computeBalance(
  type: repo.LeaveTypeRow,
  usage: { leaveTypeId: string; status: string; days: number }[],
): LeaveBalance {
  const sum = (status: string) =>
    usage
      .filter((u) => u.leaveTypeId === type.id && u.status === status)
      .reduce((n, u) => n + u.days, 0);
  const used = sum('approved');
  const pending = sum('pending');
  return {
    leaveType: type,
    quota: type.annualDays,
    used,
    pending,
    remaining: Math.max(0, type.annualDays - used - pending),
  };
}

export interface LeaveDeps {
  db: Database;
  logger: Logger;
  now?: () => Date;
}

export function createLeaveService({ db, logger, now = () => new Date() }: LeaveDeps) {
  const run = <T>(viewer: Viewer, fn: (tx: TenantTx, tenantId: string) => Promise<T>) =>
    withTenant(db, viewer.organisation.id, (tx) => fn(tx, viewer.organisation.id));

  const audit = (viewer: Viewer, action: string, target: Record<string, unknown>) =>
    logger.info(
      { audit: true, actor: viewer.user.id, tenantId: viewer.organisation.id, action, ...target },
      'hr action',
    );

  const canSeeTypes = (viewer: Viewer) =>
    ['attendance.leave.request-own', 'attendance.leave.view', 'attendance.leave-type.manage'].some(
      (k) => hasPermission(viewer.permissions, k),
    );

  async function balancesFor(tx: TenantTx, employeeId: string, year: number) {
    const [types, usage] = await Promise.all([
      repo.listLeaveTypes(tx),
      repo.usageForYear(tx, employeeId, year),
    ]);
    return types.filter((t) => t.status === 'active').map((t) => computeBalance(t, usage));
  }

  function mapTypeConflict(error: unknown): never {
    if (isUniqueViolation(error, 'leave_types_tenant_code_unique')) {
      throw new ConflictError('This code is already used', {
        fieldErrors: { code: ['This code is already used'] },
      });
    }
    throw error;
  }

  return {
    // -------------------------------------------------------------- leave types

    async listTypes(viewer: Viewer) {
      if (!canSeeTypes(viewer)) throw new ForbiddenError();
      return run(viewer, async (tx, tenantId) => {
        await ensureHrDefaults(tx, tenantId);
        return repo.listLeaveTypes(tx);
      });
    },

    async createType(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'attendance.leave-type.manage');
      const input = createLeaveTypeInputSchema.parse(raw);
      try {
        const id = await run(viewer, (tx, tenantId) =>
          repo.insertLeaveType(tx, { ...input, tenantId }),
        );
        audit(viewer, 'leave-type.create', { leaveTypeId: id });
        return (await run(viewer, (tx) => repo.findLeaveType(tx, id)))!;
      } catch (error) {
        return mapTypeConflict(error);
      }
    },

    async updateType(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'attendance.leave-type.manage');
      const id = idSchema.parse(rawId);
      const { version, ...values } = updateLeaveTypeInputSchema.parse(raw);
      await run(viewer, async (tx) => {
        if (!(await repo.findLeaveType(tx, id))) throw new NotFoundError('Leave type not found');
        if (!(await repo.updateLeaveType(tx, id, version, values))) throw new ConflictError(STALE);
      });
      audit(viewer, 'leave-type.update', { leaveTypeId: id });
      return (await run(viewer, (tx) => repo.findLeaveType(tx, id)))!;
    },

    // ----------------------------------------------------------------- balances

    /** Own balances by default. Someone else's needs "view leave" and that person inside scope. */
    async balances(viewer: Viewer, raw: unknown) {
      const input = balancesInputSchema.parse(raw ?? {});
      return run(viewer, async (tx) => {
        let target: employeeRepo.EmployeeRow | null;
        const own = await employeeRepo.findEmployeeByUser(tx, viewer.user.id);
        if (input.employeeId && input.employeeId !== own?.id) {
          requirePermission(viewer, 'attendance.leave.view');
          target = await employeeRepo.findEmployee(tx, input.employeeId);
          if (!target || !inScope(viewer, target)) throw new NotFoundError('Employee not found');
        } else {
          requirePermission(viewer, 'attendance.leave.request-own');
          target = own;
        }
        if (!target) return { employeeId: null, year: input.year, items: [] };
        return {
          employeeId: target.id,
          year: input.year,
          items: await balancesFor(tx, target.id, input.year),
        };
      });
    },

    // ----------------------------------------------------------------- requests

    async list(viewer: Viewer, raw: unknown) {
      const manager = hasPermission(viewer.permissions, 'attendance.leave.view');
      if (!manager) requirePermission(viewer, 'attendance.leave.request-own');
      const input = listLeaveInputSchema.parse(raw ?? {});
      return run(viewer, async (tx) => {
        // "-own" permissions are self-only, whatever the role's data scope says.
        const scope = manager ? scopeOf(viewer) : selfScope(viewer);
        const employeeId = manager ? input.employeeId : undefined;
        return repo.listLeave(tx, { ...input, employeeId, scope });
      });
    },

    async request(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'attendance.leave.request-own');
      const input = requestLeaveInputSchema.parse(raw);
      const startYear = Number(input.startDate.slice(0, 4));
      if (startYear !== Number(input.endDate.slice(0, 4))) {
        throw new BusinessRuleError(
          'A request cannot span two years. Submit one request for each year.',
          { fieldErrors: { endDate: ['Keep the request inside one calendar year'] } },
        );
      }
      const days = daysInclusive(input.startDate, input.endDate);

      const id = await run(viewer, async (tx, tenantId) => {
        const me = await employeeRepo.findEmployeeByUser(tx, viewer.user.id);
        if (!me) throw new BusinessRuleError('Your account is not linked to an employee record');
        if (me.status !== 'active') throw new BusinessRuleError('Your employee record is inactive');
        // Everything below reads balances and overlaps; the lock makes it one person at a time.
        await employeeRepo.lockEmployee(tx, me.id);

        const type = await repo.findLeaveType(tx, input.leaveTypeId);
        if (!type || type.status !== 'active') {
          throw new ValidationError({ leaveTypeId: ['Choose an active leave type'] });
        }
        if (input.startDate < me.joiningDate) {
          throw new BusinessRuleError('Leave cannot start before your joining date', {
            fieldErrors: { startDate: ['Choose a date on or after your joining date'] },
          });
        }
        if (await repo.findOverlap(tx, me.id, input.startDate, input.endDate)) {
          throw new BusinessRuleError('You already have leave requested for some of these dates', {
            fieldErrors: { startDate: ['These dates overlap another request'] },
          });
        }
        const balance = computeBalance(type, await repo.usageForYear(tx, me.id, startYear));
        if (days > balance.remaining) {
          throw new BusinessRuleError(
            `Only ${balance.remaining} day(s) of ${type.name} left this year; you asked for ${days}`,
            { fieldErrors: { endDate: [`Only ${balance.remaining} day(s) left`] } },
          );
        }
        return repo.insertLeave(tx, {
          tenantId,
          employeeId: me.id,
          leaveTypeId: type.id,
          startDate: input.startDate,
          endDate: input.endDate,
          days,
          reason: input.reason,
        });
      });
      audit(viewer, 'leave.request', { leaveId: id, days });
      return (await run(viewer, (tx) => repo.findLeave(tx, id)))!;
    },

    /** The requester withdraws a pending request, or an approved one that has not started. */
    async cancel(viewer: Viewer, rawId: unknown) {
      requirePermission(viewer, 'attendance.leave.request-own');
      const id = idSchema.parse(rawId);
      await run(viewer, async (tx) => {
        const found = await repo.findLeave(tx, id);
        // Someone else's request looks exactly like a missing one.
        if (!found || found.userId !== viewer.user.id)
          throw new NotFoundError('Leave request not found');
        await employeeRepo.lockEmployee(tx, found.employeeId);
        const current = await repo.lockLeave(tx, id);
        if (!current) throw new NotFoundError('Leave request not found');
        const today = localDate(now(), await organisationZone(tx));
        const cancellable =
          current.status === 'pending' ||
          (current.status === 'approved' && current.startDate > today);
        if (!cancellable) {
          throw new BusinessRuleError('This request can no longer be cancelled');
        }
        if (
          !(await repo.decideLeave(tx, id, current.version, {
            status: 'cancelled',
            decidedBy: null,
            note: null,
          }))
        ) {
          throw new ConflictError(STALE);
        }
      });
      audit(viewer, 'leave.cancel', { leaveId: id });
      return (await run(viewer, (tx) => repo.findLeave(tx, id)))!;
    },

    async decide(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'attendance.leave.approve');
      const id = idSchema.parse(rawId);
      const input = decideLeaveInputSchema.parse(raw);
      await run(viewer, async (tx) => {
        const found = await repo.findLeave(tx, id);
        if (!found || !inScope(viewer, found)) throw new NotFoundError('Leave request not found');
        if (found.userId === viewer.user.id) {
          throw new ForbiddenError('You cannot decide your own leave request');
        }
        await employeeRepo.lockEmployee(tx, found.employeeId);
        const current = await repo.lockLeave(tx, id);
        if (!current) throw new NotFoundError('Leave request not found');
        if (current.version !== input.version) throw new ConflictError(STALE);
        if (current.status !== 'pending') {
          throw new BusinessRuleError(`This request is already ${current.status}`);
        }
        if (input.decision === 'approve') {
          const type = await repo.findLeaveType(tx, current.leaveTypeId);
          const year = Number(current.startDate.slice(0, 4));
          const usage = await repo.usageForYear(tx, current.employeeId, year);
          // Pending requests are reserved, including this one, so approving cannot exceed the quota
          // unless the quota itself was lowered after the request was made.
          const approved = usage
            .filter((u) => u.leaveTypeId === current.leaveTypeId && u.status === 'approved')
            .reduce((n, u) => n + u.days, 0);
          if (!type || approved + current.days > type.annualDays) {
            throw new BusinessRuleError('Approving this would take the balance below zero');
          }
        }
        const ok = await repo.decideLeave(tx, id, current.version, {
          status: input.decision === 'approve' ? 'approved' : 'rejected',
          decidedBy: viewer.user.id,
          note: input.note ?? null,
        });
        if (!ok) throw new ConflictError(STALE);
      });
      audit(viewer, `leave.${input.decision}`, { leaveId: id });
      return (await run(viewer, (tx) => repo.findLeave(tx, id)))!;
    },
  };
}

export type LeaveService = ReturnType<typeof createLeaveService>;
