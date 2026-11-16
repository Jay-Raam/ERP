import {
  adjustPayslipInputSchema,
  approvePayrollRunInputSchema,
  cancelPayrollRunInputSchema,
  createPayrollRunInputSchema,
  hasPermission,
  listPayrollRunsInputSchema,
  listPayslipsInputSchema,
  listSalaryStructuresInputSchema,
  myPayslipsInputSchema,
  parsePaise,
  paiseToString,
  payPayrollRunInputSchema,
  recalculatePayrollRunInputSchema,
  saveSalaryStructureInputSchema,
  type Viewer,
} from '@erp/shared';
import { requirePermission } from '../../core/auth/guard';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../core/errors';
import { parseId } from '../../core/errors/parse-id';
import type { Logger } from '../../core/logger';
import { enforceLimit, type Limits, type RateLimiter } from '../../core/rate-limit';
import type { Database, TenantTx } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import { withTenant } from '../../db/tenant';
import * as ledger from '../accounts/ledger';
import { localDate } from '../hr/attendance.logic';
import * as attendanceRepo from '../hr/attendance.repository';
import * as employeeRepo from '../hr/employees.repository';
import { monthAttendance } from './month-attendance';
import { computePay, monthBounds, monthLabel } from './payroll.logic';
import * as repo from './payroll.repository';

const STALE = 'Someone else changed this record. Reload it and try again.';

export interface PayrollDeps {
  db: Database;
  logger: Logger;
  limiter: RateLimiter;
  limits: Limits;
  now?: () => Date;
}

export interface SkippedEmployee {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  reason: string;
}

type Carry = Map<string, { bonus: string; otherDeductions: string; note: string | null }>;

export function createPayrollService({
  db,
  logger,
  limiter,
  limits,
  now = () => new Date(),
}: PayrollDeps) {
  const run = <T>(viewer: Viewer, fn: (tx: TenantTx, tenantId: string) => Promise<T>) =>
    withTenant(db, viewer.organisation.id, (tx) => fn(tx, viewer.organisation.id));

  const audit = (viewer: Viewer, action: string, target: Record<string, unknown>) =>
    logger.info(
      { audit: true, actor: viewer.user.id, tenantId: viewer.organisation.id, action, ...target },
      'payroll action',
    );

  const limitWrites = (viewer: Viewer) =>
    enforceLimit(
      limiter,
      `payroll:user:${viewer.user.id}`,
      limits.payrollWritesPerUser,
      'You are making payroll changes too quickly.',
    );

  /** Pay is organisation-wide: a branch-scoped role never sees a partial payroll. */
  const requireWholeOrganisation = (viewer: Viewer) => {
    if (viewer.role.dataScope !== 'organisation') {
      throw new ForbiddenError('Payroll needs organisation-wide access');
    }
  };

  const today = async (tx: TenantTx) =>
    localDate(now(), (await attendanceRepo.organisationCalendar(tx)).timeZone);

  async function lockDraft(tx: TenantTx, id: string, version: number) {
    const locked = await repo.lockRun(tx, id);
    if (!locked) throw new NotFoundError('Payroll run not found');
    if (locked.status !== 'draft') {
      throw new BusinessRuleError('Only a draft payroll run can be changed');
    }
    if (locked.version !== version) throw new ConflictError(STALE);
    return locked;
  }

  /**
   * Works out every payslip for the month from the salary structures and attendance, and
   * replaces whatever the run had. Employees with no structure are skipped and reported.
   */
  async function buildPayslips(
    tx: TenantTx,
    tenantId: string,
    runId: string,
    period: { start: string; end: string; days: number },
    carry: Carry,
  ): Promise<SkippedEmployee[]> {
    const people = await repo.payableEmployees(tx, period.end);
    const paid = people.filter((p) => p.basic !== null);
    const skipped = people
      .filter((p) => p.basic === null)
      .map((p) => ({
        employeeId: p.employeeId,
        employeeCode: p.employeeCode,
        employeeName: p.employeeName,
        reason: 'No salary structure',
      }));

    const attendance = await monthAttendance(tx, paid, period, now());

    const rows = paid.map((p) => {
      const counts = attendance.get(p.employeeId)!;
      const adj = carry.get(p.employeeId);
      const pay = computePay({
        basic: p.basic!,
        hra: p.hra!,
        allowance: p.allowance!,
        deductions: p.deductions!,
        bonus: adj?.bonus ?? '0',
        otherDeductions: adj?.otherDeductions ?? '0',
        paidHalves: counts.paidHalves,
        daysInPeriod: period.days,
      });
      return {
        tenantId,
        runId,
        employeeId: p.employeeId,
        branchId: p.branch.id,
        employeeCode: p.employeeCode,
        employeeName: p.employeeName,
        designation: p.designation,
        basic: p.basic!,
        hra: p.hra!,
        allowance: p.allowance!,
        daysInPeriod: period.days,
        paidHalfDays: counts.paidHalves,
        presentDays: counts.present,
        halfDays: counts.half,
        leaveDays: counts.leave,
        offDays: counts.off,
        holidayDays: counts.holiday,
        absentDays: counts.absent,
        shortDays: counts.short,
        incompleteDays: counts.incomplete,
        fullGross: pay.fullGross,
        earned: pay.earned,
        bonus: pay.bonus,
        plannedDeductions: p.deductions!,
        deductions: pay.deductions,
        otherDeductions: pay.otherDeductions,
        deductionsCapped: pay.capped ? 1 : 0,
        adjustmentNote: adj?.note ?? null,
        netPay: pay.net,
      };
    });
    await repo.insertPayslips(tx, rows);
    await repo.refreshRunTotals(tx, runId);
    return skipped;
  }

  async function runDetail(tx: TenantTx, id: string) {
    const found = await repo.findRun(tx, id);
    if (!found) throw new NotFoundError('Payroll run not found');
    const slips = await repo.allPayslips(tx, id);
    return {
      ...found,
      label: monthLabel(found.periodStart),
      incompleteCount: slips.filter((s) => s.incompleteDays > 0).length,
      cappedCount: slips.filter((s) => s.deductionsCapped).length,
    };
  }

  const sum = (
    rows: {
      earned: string;
      bonus: string;
      deductions: string;
      otherDeductions: string;
      netPay: string;
    }[],
  ) => {
    let gross = 0n;
    let ded = 0n;
    let net = 0n;
    for (const r of rows) {
      gross += parsePaise(r.earned) + parsePaise(r.bonus);
      ded += parsePaise(r.deductions) + parsePaise(r.otherDeductions);
      net += parsePaise(r.netPay);
    }
    return { gross, ded, net };
  };

  return {
    // ------------------------------------------------------------ structures

    async listSalaryStructures(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'payroll.structure.view');
      requireWholeOrganisation(viewer);
      const input = listSalaryStructuresInputSchema.parse(raw ?? {});
      return run(viewer, (tx) => repo.listStructures(tx, input));
    },

    async saveSalaryStructure(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'payroll.structure.manage');
      requireWholeOrganisation(viewer);
      await limitWrites(viewer);
      const input = saveSalaryStructureInputSchema.parse(raw);
      const values = {
        basic: input.basic,
        hra: input.hra,
        allowance: input.allowance,
        deductions: input.deductions,
      };
      // A deduction larger than the monthly gross could never be taken in full.
      if (
        parsePaise(input.deductions) >
        parsePaise(input.basic) + parsePaise(input.hra) + parsePaise(input.allowance)
      ) {
        throw new ValidationError({
          deductions: ['Deductions cannot be more than the monthly gross'],
        });
      }
      await run(viewer, async (tx, tenantId) => {
        const emp = await repo.findStructureRow(tx, input.employeeId);
        if (!emp) throw new NotFoundError('Employee not found');
        if (emp.status !== 'active') {
          throw new BusinessRuleError('This employee is inactive');
        }
        if (input.version === null) {
          try {
            await repo.insertStructure(tx, { tenantId, employeeId: input.employeeId, ...values });
          } catch (error) {
            if (isUniqueViolation(error, 'salary_structures_employee_unique')) {
              throw new ConflictError(STALE);
            }
            throw error;
          }
        } else if (!(await repo.updateStructure(tx, input.employeeId, input.version, values))) {
          throw new ConflictError(STALE);
        }
      });
      audit(viewer, 'payroll.structure.save', { employeeId: input.employeeId });
      return run(viewer, async (tx) => (await repo.findStructureRow(tx, input.employeeId))!);
    },

    // ------------------------------------------------------------------ runs

    async listPayrollRuns(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'payroll.run.view');
      requireWholeOrganisation(viewer);
      const input = listPayrollRunsInputSchema.parse(raw ?? {});
      return run(viewer, (tx) => repo.listRuns(tx, input));
    },

    async getPayrollRun(viewer: Viewer, rawId: unknown) {
      requirePermission(viewer, 'payroll.run.view');
      requireWholeOrganisation(viewer);
      const id = parseId(rawId);
      return run(viewer, (tx) => runDetail(tx, id));
    },

    async listPayslips(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'payroll.run.view');
      requireWholeOrganisation(viewer);
      const input = listPayslipsInputSchema.parse(raw);
      return run(viewer, async (tx) => {
        if (!(await repo.findRun(tx, input.runId)))
          throw new NotFoundError('Payroll run not found');
        return repo.listPayslips(tx, input);
      });
    },

    async createPayrollRun(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'payroll.run.prepare');
      requireWholeOrganisation(viewer);
      await limitWrites(viewer);
      const input = createPayrollRunInputSchema.parse(raw);
      const period = monthBounds(input.month);

      const result = await run(viewer, async (tx, tenantId) => {
        if (period.end >= (await today(tx))) {
          throw new ValidationError({
            month: ['Payroll can only be prepared after the month has ended'],
          });
        }
        let id: string;
        try {
          id = await repo.insertRun(tx, {
            tenantId,
            periodStart: period.start,
            periodEnd: period.end,
            notes: input.notes,
            preparedBy: viewer.user.id,
          });
        } catch (error) {
          if (isUniqueViolation(error, 'payroll_runs_period_once')) {
            throw new BusinessRuleError(
              `A payroll run for ${monthLabel(period.start)} already exists`,
            );
          }
          throw error;
        }
        const skipped = await buildPayslips(tx, tenantId, id, period, new Map());
        const detail = await runDetail(tx, id);
        if (detail.employeeCount === 0) {
          throw new BusinessRuleError(
            'No employee has a salary structure for this month. Set salaries first.',
          );
        }
        return { run: detail, skipped };
      });
      audit(viewer, 'payroll.run.create', { runId: result.run.id, month: input.month });
      return result;
    },

    /** Rebuilds a draft from the latest structures and attendance; bonuses and one-off deductions are kept. */
    async recalculatePayrollRun(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'payroll.run.prepare');
      requireWholeOrganisation(viewer);
      await limitWrites(viewer);
      const id = parseId(rawId);
      const input = recalculatePayrollRunInputSchema.parse(raw);
      const result = await run(viewer, async (tx, tenantId) => {
        const locked = await lockDraft(tx, id, input.version);
        const old = await repo.allPayslips(tx, id);
        const carry: Carry = new Map(
          old.map((s) => [
            s.employeeId,
            { bonus: s.bonus, otherDeductions: s.otherDeductions, note: s.adjustmentNote },
          ]),
        );
        await repo.deletePayslips(tx, id);
        const skipped = await buildPayslips(
          tx,
          tenantId,
          id,
          {
            start: locked.periodStart,
            end: locked.periodEnd,
            days: monthBounds(locked.periodStart.slice(0, 7)).days,
          },
          carry,
        );
        const detail = await runDetail(tx, id);
        if (detail.employeeCount === 0) {
          throw new BusinessRuleError('No employee has a salary structure for this month.');
        }
        return { run: detail, skipped };
      });
      audit(viewer, 'payroll.run.recalculate', { runId: id });
      return result;
    },

    async adjustPayslip(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'payroll.run.prepare');
      requireWholeOrganisation(viewer);
      await limitWrites(viewer);
      const slipId = parseId(rawId);
      const input = adjustPayslipInputSchema.parse(raw);
      await run(viewer, async (tx) => {
        const runId = await repo.payslipRunId(tx, slipId);
        if (!runId) throw new NotFoundError('Payslip not found');
        await lockDraft(tx, runId, input.version);
        const slip = (await repo.findPayslip(tx, slipId))!;
        const pay = computePay({
          basic: slip.basic,
          hra: slip.hra,
          allowance: slip.allowance,
          deductions: slip.plannedDeductions,
          bonus: input.bonus,
          otherDeductions: input.otherDeductions,
          paidHalves: slip.paidHalfDays,
          daysInPeriod: slip.daysInPeriod,
        });
        // A one-off deduction is typed in, so say so when it cannot be taken in full.
        if (parsePaise(pay.otherDeductions) < parsePaise(input.otherDeductions)) {
          throw new ValidationError({
            otherDeductions: ['This is more than the pay available after the other deductions'],
          });
        }
        await repo.updatePayslipPay(tx, slipId, {
          bonus: pay.bonus,
          otherDeductions: pay.otherDeductions,
          deductions: pay.deductions,
          capped: pay.capped,
          note: input.note,
          netPay: pay.net,
        });
        await repo.refreshRunTotals(tx, runId);
      });
      audit(viewer, 'payroll.payslip.adjust', { payslipId: slipId });
      return run(viewer, async (tx) => (await repo.findPayslip(tx, slipId))!);
    },

    async approvePayrollRun(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'payroll.run.approve');
      requireWholeOrganisation(viewer);
      await limitWrites(viewer);
      const id = parseId(rawId);
      const input = approvePayrollRunInputSchema.parse(raw);
      await run(viewer, async (tx, tenantId) => {
        const locked = await lockDraft(tx, id, input.version);
        if (locked.preparedBy === viewer.user.id) {
          throw new BusinessRuleError('Someone else must approve this payroll run');
        }
        const slips = await repo.allPayslips(tx, id);
        if (slips.length === 0) throw new BusinessRuleError('This run has no payslips');
        const t = sum(slips);
        const ids = await ledger.systemAccountIds(tx, tenantId);
        const entryId = await ledger.postEntry(
          tx,
          viewer.user.id,
          tenantId,
          {
            entryDate: locked.periodEnd,
            memo: `Payroll for ${monthLabel(locked.periodStart)}`,
            sourceType: 'payroll',
            sourceId: id,
            branchId: null,
            lines: [
              { account: '5200', debit: t.gross, credit: 0n },
              { account: '2200', debit: 0n, credit: t.net },
              { account: '2210', debit: 0n, credit: t.ded },
            ],
          },
          ids,
        );
        await repo.setApproved(tx, id, { approvedBy: viewer.user.id, entryId });
      });
      audit(viewer, 'payroll.run.approve', { runId: id });
      return run(viewer, (tx) => runDetail(tx, id));
    },

    async payPayrollRun(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'payroll.run.pay');
      requireWholeOrganisation(viewer);
      await limitWrites(viewer);
      const id = parseId(rawId);
      const input = payPayrollRunInputSchema.parse(raw);
      await run(viewer, async (tx, tenantId) => {
        const locked = await repo.lockRun(tx, id);
        if (!locked) throw new NotFoundError('Payroll run not found');
        if (locked.status !== 'approved') {
          throw new BusinessRuleError('Only an approved payroll run can be paid');
        }
        if (locked.version !== input.version) throw new ConflictError(STALE);
        if (input.paidOn < locked.periodEnd || input.paidOn > (await today(tx))) {
          throw new ValidationError({
            paidOn: ['The pay date must be after the month ends and not in the future'],
          });
        }
        const t = sum(await repo.allPayslips(tx, id));
        const ids = await ledger.systemAccountIds(tx, tenantId);
        const entryId = await ledger.postEntry(
          tx,
          viewer.user.id,
          tenantId,
          {
            entryDate: input.paidOn,
            memo: `Salaries paid for ${monthLabel(locked.periodStart)}`,
            sourceType: 'payroll',
            sourceId: id,
            branchId: null,
            lines: [
              { account: '2200', debit: t.net, credit: 0n },
              { account: input.method === 'cash' ? '1000' : '1010', debit: 0n, credit: t.net },
            ],
          },
          ids,
        );
        await repo.setPaid(tx, id, {
          paidBy: viewer.user.id,
          paidOn: input.paidOn,
          method: input.method,
          reference: input.reference,
          entryId,
        });
      });
      audit(viewer, 'payroll.run.pay', { runId: id, method: input.method });
      return run(viewer, (tx) => runDetail(tx, id));
    },

    async cancelPayrollRun(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'payroll.run.prepare');
      requireWholeOrganisation(viewer);
      await limitWrites(viewer);
      const id = parseId(rawId);
      const input = cancelPayrollRunInputSchema.parse(raw);
      await run(viewer, async (tx, tenantId) => {
        const locked = await repo.lockRun(tx, id);
        if (!locked) throw new NotFoundError('Payroll run not found');
        if (locked.version !== input.version) throw new ConflictError(STALE);
        if (locked.status === 'paid') {
          throw new BusinessRuleError(
            'A paid payroll run cannot be cancelled. Post a journal entry to correct it.',
          );
        }
        if (locked.status === 'cancelled') {
          throw new BusinessRuleError('This payroll run is already cancelled');
        }
        let entryId: string | null = null;
        if (locked.status === 'approved') {
          // Undoing a posted run changes the books, so it needs the approver's permission.
          requirePermission(viewer, 'payroll.run.approve');
          const found = (await repo.findRun(tx, id))!;
          entryId = await ledger.reverseEntry(
            tx,
            viewer.user.id,
            tenantId,
            { id: found.approveEntryId!, branchId: null },
            `Payroll for ${monthLabel(locked.periodStart)} cancelled: ${input.reason}`,
            await today(tx),
          );
        }
        await repo.setCancelled(tx, id, {
          cancelledBy: viewer.user.id,
          reason: input.reason,
          entryId,
        });
      });
      audit(viewer, 'payroll.run.cancel', { runId: id });
      return run(viewer, (tx) => runDetail(tx, id));
    },

    // --------------------------------------------------------------- self-service

    /** The signed-in person's own payslips, from runs that have been approved. */
    async myPayslips(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'payroll.payslip.view-own');
      const input = myPayslipsInputSchema.parse(raw ?? {});
      return run(viewer, async (tx) => {
        const me = await employeeRepo.findEmployeeByUser(tx, viewer.user.id);
        if (!me) return { items: [], total: 0 };
        return repo.myPayslips(tx, me.id, input);
      });
    },

    /** Who may see which payslips: managers see a run's, everyone sees their own. */
    canSeeRuns: (viewer: Viewer) => hasPermission(viewer.permissions, 'payroll.run.view'),
  };
}

export type PayrollService = ReturnType<typeof createPayrollService>;
export { paiseToString };
