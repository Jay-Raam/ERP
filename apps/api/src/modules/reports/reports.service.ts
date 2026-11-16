import {
  attendanceSummaryInputSchema,
  balanceSheetInputSchema,
  financialYearStart,
  invoiceSummaryInputSchema,
  paiseToString,
  parsePaise,
  payrollSummaryInputSchema,
  profitAndLossInputSchema,
  stockReportInputSchema,
  type Viewer,
} from '@erp/shared';
import { requirePermission } from '../../core/auth/guard';
import { ForbiddenError } from '../../core/errors';
import type { Logger } from '../../core/logger';
import type { Database, TenantTx } from '../../db/client';
import { withTenant } from '../../db/tenant';
import { localDate } from '../hr/attendance.logic';
import * as attendanceRepo from '../hr/attendance.repository';
import * as employeeRepo from '../hr/employees.repository';
import { assertBranchInScope, scopeOf } from '../hr/scope';
import { monthAttendance } from '../payroll/month-attendance';
import { monthBounds, monthLabel } from '../payroll/payroll.logic';
import * as repo from './reports.repository';

export interface ReportsDeps {
  db: Database;
  logger: Logger;
  now?: () => Date;
}

const ZERO = 0n;

export function createReportsService({ db, logger, now = () => new Date() }: ReportsDeps) {
  const run = <T>(viewer: Viewer, fn: (tx: TenantTx) => Promise<T>) =>
    withTenant(db, viewer.organisation.id, fn);

  const today = async (tx: TenantTx) =>
    localDate(now(), (await attendanceRepo.organisationCalendar(tx)).timeZone);

  /** Company-wide figures only: a slice of the books would not add up, so branch roles do not get them. */
  const requireWholeOrganisation = (viewer: Viewer) => {
    if (viewer.role.dataScope !== 'organisation') {
      throw new ForbiddenError('This report needs organisation-wide access');
    }
  };

  const audit = (viewer: Viewer, report: string, params: Record<string, unknown>) =>
    logger.info(
      { audit: true, actor: viewer.user.id, tenantId: viewer.organisation.id, report, ...params },
      'report viewed',
    );

  /** Signed amount in paise for one account line; zero lines are left out of the report. */
  const lines = (
    rows: repo.MovementRow[],
    side: 'debit' | 'credit',
  ): { code: string; name: string; amount: bigint }[] =>
    rows
      .map((r) => {
        const d = parsePaise(r.debit);
        const c = parsePaise(r.credit);
        return { code: r.code, name: r.name, amount: side === 'debit' ? d - c : c - d };
      })
      .filter((l) => l.amount !== ZERO);

  const total = (rows: { amount: bigint }[]) => rows.reduce((s, r) => s + r.amount, ZERO);
  const shape = (rows: { code: string; name: string; amount: bigint }[]) =>
    rows.map((r) => ({ ...r, amount: paiseToString(r.amount) }));

  return {
    async profitAndLoss(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'report.financial.view');
      requireWholeOrganisation(viewer);
      const input = profitAndLossInputSchema.parse(raw ?? {});
      return run(viewer, async (tx) => {
        const to = input.to ?? (await today(tx));
        const from = input.from ?? financialYearStart(to);
        const rows = await repo.accountMovement(tx, { types: ['income', 'expense'], from, to });
        const income = lines(
          rows.filter((r) => r.type === 'income'),
          'credit',
        );
        const expenses = lines(
          rows.filter((r) => r.type === 'expense'),
          'debit',
        );
        const totalIncome = total(income);
        const totalExpenses = total(expenses);
        audit(viewer, 'profit-and-loss', { from, to });
        return {
          from,
          to,
          income: shape(income),
          expenses: shape(expenses),
          totalIncome: paiseToString(totalIncome),
          totalExpenses: paiseToString(totalExpenses),
          netProfit: paiseToString(totalIncome - totalExpenses),
        };
      });
    },

    async balanceSheet(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'report.financial.view');
      requireWholeOrganisation(viewer);
      const input = balanceSheetInputSchema.parse(raw ?? {});
      return run(viewer, async (tx) => {
        const asOf = input.asOf ?? (await today(tx));
        const rows = await repo.accountMovement(tx, {
          types: ['asset', 'liability', 'equity', 'income', 'expense'],
          to: asOf,
        });
        const of = (type: string, side: 'debit' | 'credit') =>
          lines(
            rows.filter((r) => r.type === type),
            side,
          );
        const assets = of('asset', 'debit');
        const liabilities = of('liability', 'credit');
        const equity = of('equity', 'credit');
        // Profit that has not been moved into equity yet, so the sheet balances without a year-end close.
        const earnings = total(of('income', 'credit')) - total(of('expense', 'debit'));
        const totalAssets = total(assets);
        const totalLiabilities = total(liabilities);
        const totalEquity = total(equity) + earnings;
        audit(viewer, 'balance-sheet', { asOf });
        return {
          asOf,
          assets: shape(assets),
          liabilities: shape(liabilities),
          equity: shape(equity),
          earnings: paiseToString(earnings),
          totalAssets: paiseToString(totalAssets),
          totalLiabilities: paiseToString(totalLiabilities),
          totalEquity: paiseToString(totalEquity),
          balanced: totalAssets === totalLiabilities + totalEquity,
        };
      });
    },

    /** Sales or purchases that were posted to the books, by month, party and item. */
    async invoiceSummary(viewer: Viewer, raw: unknown) {
      const input = invoiceSummaryInputSchema.parse(raw);
      requirePermission(
        viewer,
        input.kind === 'sales' ? 'report.sales.view' : 'report.operational.view',
      );
      if (input.branchId) assertBranchInScope(viewer, input.branchId);
      return run(viewer, async (tx) => {
        const to = input.to ?? (await today(tx));
        const from = input.from ?? financialYearStart(to);
        const filter: repo.InvoiceFilter = {
          kind: input.kind,
          from,
          to,
          branchId: input.branchId,
          scope: scopeOf(viewer),
        };
        const [totals, byMonth, byParty, byItem] = await Promise.all([
          repo.invoiceTotals(tx, filter),
          repo.invoicesByMonth(tx, filter),
          repo.invoicesByParty(tx, filter),
          repo.invoicesByItem(tx, filter),
        ]);
        audit(viewer, `${input.kind}-summary`, { from, to });
        return {
          kind: input.kind,
          from,
          to,
          count: totals.count,
          subtotal: totals.subtotal,
          taxTotal: totals.taxTotal,
          grandTotal: totals.grandTotal,
          paid: totals.paid,
          outstanding: paiseToString(parsePaise(totals.grandTotal) - parsePaise(totals.paid)),
          byMonth,
          byParty,
          byItem,
        };
      });
    },

    /**
     * Stock on hand, valued at the weighted average of what was paid on purchase orders. It is an
     * approximation, not FIFO: items that were never bought have no value and are counted.
     */
    async stockReport(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'report.operational.view');
      requireWholeOrganisation(viewer);
      const input = stockReportInputSchema.parse(raw ?? {});
      return run(viewer, async (tx) => {
        const [items, totals, asOf] = await Promise.all([
          repo.stockRows(tx, input),
          repo.stockTotals(tx, input),
          today(tx),
        ]);
        return { asOf, items, ...totals, totalValue: totals.value };
      });
    },

    /** One row per active employee: the days of the month by kind, counted the way payroll pays them. */
    async attendanceSummary(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'report.operational.view');
      requireWholeOrganisation(viewer);
      const input = attendanceSummaryInputSchema.parse(raw ?? {});
      return run(viewer, async (tx) => {
        const month = input.month ?? (await today(tx)).slice(0, 7);
        const period = monthBounds(month);
        const page = await employeeRepo.listEmployees(tx, {
          scope: { kind: 'organisation' },
          status: 'active',
          search: input.search,
          branchId: input.branchId,
          limit: input.limit,
          offset: input.offset,
        });
        const counts = await monthAttendance(
          tx,
          page.items.map((e) => ({
            employeeId: e.id,
            joiningDate: e.joiningDate,
            shiftId: e.shiftId,
          })),
          period,
          now(),
        );
        audit(viewer, 'attendance-summary', { month });
        return {
          month,
          label: monthLabel(period.start),
          total: page.total,
          items: page.items.map((e) => {
            const c = counts.get(e.id)!;
            return {
              employeeId: e.id,
              employeeCode: e.employeeCode,
              employeeName: e.fullName,
              branch: e.branch,
              presentDays: c.present,
              halfDays: c.half,
              leaveDays: c.leave,
              offDays: c.off,
              holidayDays: c.holiday,
              absentDays: c.absent,
              shortDays: c.short,
              incompleteDays: c.incomplete,
              paidHalfDays: c.paidHalves,
            };
          }),
        };
      });
    },

    /** What payroll cost, by month and by branch, from runs that were not cancelled. */
    async payrollSummary(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'report.financial.view');
      requireWholeOrganisation(viewer);
      const input = payrollSummaryInputSchema.parse(raw ?? {});
      return run(viewer, async (tx) => {
        const current = (await today(tx)).slice(0, 7);
        const toMonth = input.toMonth ?? current;
        const fromMonth = input.fromMonth ?? financialYearStart(`${toMonth}-01`).slice(0, 7);
        const from = `${fromMonth}-01`;
        const to = `${toMonth}-01`;
        const [runs, byBranch] = await Promise.all([
          repo.payrollRunsBetween(tx, from, to),
          repo.payrollByBranch(tx, from, to),
        ]);
        let gross = ZERO;
        let deductions = ZERO;
        let net = ZERO;
        for (const r of runs) {
          gross += parsePaise(r.gross);
          deductions += parsePaise(r.deductions);
          net += parsePaise(r.net);
        }
        audit(viewer, 'payroll-summary', { fromMonth, toMonth });
        return {
          fromMonth,
          toMonth,
          runs: runs.map((r) => ({ ...r, label: monthLabel(r.periodStart) })),
          byBranch,
          gross: paiseToString(gross),
          deductions: paiseToString(deductions),
          net: paiseToString(net),
        };
      });
    },
  };
}

export type ReportsService = ReturnType<typeof createReportsService>;
