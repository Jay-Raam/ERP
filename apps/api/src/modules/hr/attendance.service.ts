import {
  attendanceRangeInputSchema,
  createShiftInputSchema,
  hasPermission,
  idSchema,
  manualPunchInputSchema,
  punchInputSchema,
  updateShiftInputSchema,
  type Viewer,
} from '@erp/shared';
import { requirePermission } from '../../core/auth/guard';
import { BusinessRuleError, ConflictError, ForbiddenError, NotFoundError } from '../../core/errors';
import type { Logger } from '../../core/logger';
import type { Database, TenantTx } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import { withTenant } from '../../db/tenant';
import * as repo from './attendance.repository';
import {
  MIN_GAP_SECONDS,
  buildDays,
  localDate,
  nextPunchKind,
  type ShiftRules,
} from './attendance.logic';
import { ensureHrDefaults } from './defaults.repository';
import * as employeeRepo from './employees.repository';
import { inScope, scopeOf } from './scope';

const STALE = 'Someone else changed this record. Reload it and try again.';
/** Clock skew tolerated for manual entries. */
const FUTURE_TOLERANCE_MS = 60_000;

export interface AttendanceDeps {
  db: Database;
  logger: Logger;
  /** Injected so tests can control the clock. */
  now?: () => Date;
}

export function createAttendanceService({ db, logger, now = () => new Date() }: AttendanceDeps) {
  const run = <T>(viewer: Viewer, fn: (tx: TenantTx, tenantId: string) => Promise<T>) =>
    withTenant(db, viewer.organisation.id, (tx) => fn(tx, viewer.organisation.id));

  const audit = (viewer: Viewer, action: string, target: Record<string, unknown>) =>
    logger.info(
      { audit: true, actor: viewer.user.id, tenantId: viewer.organisation.id, action, ...target },
      'hr action',
    );

  const shiftRules = (s: {
    startTime: string;
    graceMinutes: number;
    fullDayMinutes: number;
    halfDayMinutes: number;
  }): ShiftRules => s;

  async function todayFor(tx: TenantTx, employeeId: string, shiftId: string | null) {
    const zone = await repo.organisationZone(tx);
    const date = localDate(now(), zone);
    const [shift] = shiftId ? await repo.shiftsByIds(tx, [shiftId]) : [];
    const punches = await repo.punchesInRange(tx, [employeeId], date, date, zone);
    const [day] = buildDays({
      from: date,
      to: date,
      today: date,
      joiningDate: '0000-01-01',
      punches: punches.map((p) => ({ id: p.id, kind: p.kind, at: p.at })),
      leave: [],
      shift: shift ? shiftRules(shift) : null,
      timeZone: zone,
    });
    return {
      date,
      timeZone: zone,
      state: punches.at(-1)?.kind === 'in' ? ('in' as const) : ('out' as const),
      day: day!,
      punches,
    };
  }

  return {
    // ------------------------------------------------------------- self-service

    /** The signed-in person's day so far. */
    async today(viewer: Viewer) {
      requirePermission(viewer, 'attendance.record.view-own');
      return run(viewer, async (tx) => {
        const me = await employeeRepo.findEmployeeByUser(tx, viewer.user.id);
        if (!me) return null;
        return { employee: me, ...(await todayFor(tx, me.id, me.shiftId)) };
      });
    },

    /**
     * One button. The server decides whether this is an "in" or an "out" from
     * the last punch; the client never says which, and never sends a time.
     */
    async punch(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'attendance.punch.create-own');
      const { note } = punchInputSchema.parse(raw ?? {});
      const result = await run(viewer, async (tx, tenantId) => {
        const me = await employeeRepo.findEmployeeByUser(tx, viewer.user.id);
        if (!me) throw new BusinessRuleError('Your account is not linked to an employee record');
        if (me.status !== 'active') throw new BusinessRuleError('Your employee record is inactive');
        // Serialise this person's punches so two taps cannot both see the same "last" punch.
        await employeeRepo.lockEmployee(tx, me.id);
        const at = now();
        const last = await repo.lastPunch(tx, me.id);
        if (last && at.getTime() - last.at.getTime() < MIN_GAP_SECONDS * 1000) {
          throw new BusinessRuleError('You just punched. Wait a few seconds and try again.');
        }
        const kind = nextPunchKind(last);
        await repo.insertPunch(tx, {
          tenantId,
          employeeId: me.id,
          branchId: me.branchId,
          punchedAt: at,
          kind,
          source: 'self',
          note: note ?? null,
          createdBy: viewer.user.id,
        });
        return { employee: me, kind, ...(await todayFor(tx, me.id, me.shiftId)) };
      });
      audit(viewer, 'attendance.punch', { employeeId: result.employee.id, kind: result.kind });
      return result;
    },

    // ------------------------------------------------------------- corrections

    /**
     * A supervisor adds a missed in, out, or whole session. The original records are
     * never edited, and the result must still alternate in/out with its neighbours.
     */
    async addManualPunch(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'attendance.record.manage');
      const input = manualPunchInputSchema.parse(raw);
      const entries = (
        [
          input.inAt ? { kind: 'in' as const, at: new Date(input.inAt) } : null,
          input.outAt ? { kind: 'out' as const, at: new Date(input.outAt) } : null,
        ] as const
      ).filter((e): e is { kind: 'in' | 'out'; at: Date } => e !== null);
      const latest = Math.max(...entries.map((e) => e.at.getTime()));
      if (latest > now().getTime() + FUTURE_TOLERANCE_MS) {
        throw new BusinessRuleError('A punch cannot be in the future');
      }
      const fits = new BusinessRuleError(
        'That does not fit the existing punches. Punches must alternate between in and out.',
      );
      try {
        await run(viewer, async (tx, tenantId) => {
          const target = await employeeRepo.lockEmployee(tx, input.employeeId);
          if (!target || !inScope(viewer, target)) throw new NotFoundError('Employee not found');
          const first = entries[0]!;
          const last = entries.at(-1)!;
          const prev = await repo.punchBefore(tx, target.id, first.at);
          const next = await repo.punchAfter(tx, target.id, last.at);
          // Nothing may already sit between the new punches.
          const inside =
            entries.length === 2 ? await repo.punchAfter(tx, target.id, first.at) : null;
          if (
            nextPunchKind(prev) !== first.kind ||
            next?.kind === last.kind ||
            (inside && inside.at.getTime() <= last.at.getTime())
          ) {
            throw fits;
          }
          for (const e of entries) {
            await repo.insertPunch(tx, {
              tenantId,
              employeeId: target.id,
              branchId: target.branchId,
              punchedAt: e.at,
              kind: e.kind,
              source: 'manual',
              note: input.reason,
              createdBy: viewer.user.id,
            });
          }
        });
      } catch (error) {
        if (isUniqueViolation(error, 'punches_employee_time_unique')) {
          throw new ConflictError('This employee already has a punch at that exact time');
        }
        throw error;
      }
      audit(viewer, 'attendance.manual-punch', {
        employeeId: input.employeeId,
        inAt: input.inAt,
        outAt: input.outAt,
      });
      return true;
    },

    // ------------------------------------------------------------------ reports

    /**
     * Day-by-day attendance. Managers see employees inside their data scope;
     * anyone else with only the "own" permission sees just themselves.
     */
    async range(viewer: Viewer, raw: unknown) {
      const managerView = hasPermission(viewer.permissions, 'attendance.record.view');
      if (!managerView) requirePermission(viewer, 'attendance.record.view-own');
      const input = attendanceRangeInputSchema.parse(raw);

      return run(viewer, async (tx) => {
        const zone = await repo.organisationZone(tx);
        const today = localDate(now(), zone);

        let people: employeeRepo.EmployeeRow[];
        let total: number;
        if (managerView && input.employeeId) {
          const one = await employeeRepo.findEmployee(tx, input.employeeId);
          if (!one || !inScope(viewer, one)) throw new NotFoundError('Employee not found');
          people = [one];
          total = 1;
        } else if (managerView) {
          const page = await employeeRepo.listEmployees(tx, {
            scope: scopeOf(viewer),
            branchId: input.branchId,
            limit: input.limit,
            offset: input.offset,
          });
          people = page.items;
          total = page.total;
        } else {
          // "-own" permissions are self-only, whatever the role's data scope says.
          const me = await employeeRepo.findEmployeeByUser(tx, viewer.user.id);
          if (input.employeeId && input.employeeId !== me?.id) throw new ForbiddenError();
          people = me ? [me] : [];
          total = people.length;
        }

        const ids = people.map((p) => p.id);
        const [punches, leave, shiftRows] = await Promise.all([
          repo.punchesInRange(tx, ids, input.from, input.to, zone),
          repo.approvedLeaveInRange(tx, ids, input.from, input.to),
          repo.shiftsByIds(tx, [
            ...new Set(people.map((p) => p.shiftId).filter((x): x is string => !!x)),
          ]),
        ]);
        const shiftById = new Map(shiftRows.map((s) => [s.id, s]));

        const items = people.map((p) => {
          const shift = p.shiftId ? shiftById.get(p.shiftId) : undefined;
          const days = buildDays({
            from: input.from,
            to: input.to,
            today,
            joiningDate: p.joiningDate,
            punches: punches
              .filter((x) => x.employeeId === p.id)
              .map((x) => ({ id: x.id, kind: x.kind, at: x.at })),
            leave: leave.filter((l) => l.employeeId === p.id),
            shift: shift ? shiftRules(shift) : null,
            timeZone: zone,
          });
          return { employee: p, days };
        });
        return { timeZone: zone, from: input.from, to: input.to, total, items };
      });
    },

    // ------------------------------------------------------------------ shifts

    async listShifts(viewer: Viewer) {
      requirePermission(viewer, 'attendance.shift.view');
      return run(viewer, async (tx, tenantId) => {
        await ensureHrDefaults(tx, tenantId);
        return repo.listShifts(tx);
      });
    },

    async createShift(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'attendance.shift.manage');
      const input = createShiftInputSchema.parse(raw);
      try {
        const id = await run(viewer, (tx, tenantId) =>
          repo.insertShift(tx, { ...input, tenantId }),
        );
        audit(viewer, 'shift.create', { shiftId: id });
        return (await run(viewer, (tx) => repo.findShift(tx, id)))!;
      } catch (error) {
        if (isUniqueViolation(error, 'shifts_tenant_name_unique')) {
          throw new ConflictError('A shift with this name already exists', {
            fieldErrors: { name: ['A shift with this name already exists'] },
          });
        }
        throw error;
      }
    },

    async updateShift(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'attendance.shift.manage');
      const id = idSchema.parse(rawId);
      const { version, ...values } = updateShiftInputSchema.parse(raw);
      try {
        await run(viewer, async (tx) => {
          const current = await repo.findShift(tx, id);
          if (!current) throw new NotFoundError('Shift not found');
          if (!(await repo.updateShift(tx, id, version, values))) throw new ConflictError(STALE);
        });
        audit(viewer, 'shift.update', { shiftId: id });
        return (await run(viewer, (tx) => repo.findShift(tx, id)))!;
      } catch (error) {
        if (isUniqueViolation(error, 'shifts_tenant_name_unique')) {
          throw new ConflictError('A shift with this name already exists', {
            fieldErrors: { name: ['A shift with this name already exists'] },
          });
        }
        throw error;
      }
    },
  };
}

export type AttendanceService = ReturnType<typeof createAttendanceService>;
