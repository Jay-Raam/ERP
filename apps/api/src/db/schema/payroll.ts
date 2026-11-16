import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps, version } from './columns';
import { employees } from './hr';
import { branches, organisations, users } from './tenancy';

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'restrict' });

const money = (name: string, precision = 14) => numeric(name, { precision, scale: 2 });

export const payrollStatus = pgEnum('payroll_status', ['draft', 'approved', 'paid', 'cancelled']);

/** What one employee is paid for a full month. Amounts in rupees with two decimals. */
export const salaryStructures = pgTable(
  'salary_structures',
  {
    id: id(),
    tenantId: tenantId(),
    employeeId: uuid('employee_id').notNull(),
    basic: money('basic', 12).notNull(),
    hra: money('hra', 12).notNull().default('0'),
    allowance: money('allowance', 12).notNull().default('0'),
    /** A fixed monthly deduction (tax, PF, loan...). Capped at what was earned in a run. */
    deductions: money('deductions', 12).notNull().default('0'),
    ...timestamps,
    version: version(),
  },
  (t) => [
    unique('salary_structures_employee_unique').on(t.tenantId, t.employeeId),
    foreignKey({
      name: 'salary_structures_employee_fk',
      columns: [t.tenantId, t.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
    }).onDelete('restrict'),
    check(
      'salary_structures_amounts',
      sql`${t.basic} > 0 and ${t.hra} >= 0 and ${t.allowance} >= 0 and ${t.deductions} >= 0`,
    ),
    check('salary_structures_limit', sql`${t.basic} + ${t.hra} + ${t.allowance} <= 99999999.99`),
  ],
);

/** One month's payroll for the whole organisation: draft, approved (posted to the ledger), then paid. */
export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: id(),
    tenantId: tenantId(),
    /** First and last day of the month being paid. */
    periodStart: date('period_start', { mode: 'string' }).notNull(),
    periodEnd: date('period_end', { mode: 'string' }).notNull(),
    status: payrollStatus('status').notNull().default('draft'),
    notes: text('notes'),
    employeeCount: integer('employee_count').notNull().default(0),
    grossTotal: money('gross_total', 18).notNull().default('0'),
    deductionsTotal: money('deductions_total', 18).notNull().default('0'),
    netTotal: money('net_total', 18).notNull().default('0'),
    preparedBy: uuid('prepared_by').notNull(),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approveEntryId: uuid('approve_entry_id'),
    paidBy: uuid('paid_by'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    paidOn: date('paid_on', { mode: 'string' }),
    payMethod: text('pay_method'),
    payReference: text('pay_reference'),
    payEntryId: uuid('pay_entry_id'),
    cancelledBy: uuid('cancelled_by'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    cancelEntryId: uuid('cancel_entry_id'),
    ...timestamps,
    version: version(),
  },
  (t) => [
    unique('payroll_runs_tenant_id_unique').on(t.tenantId, t.id),
    uniqueIndex('payroll_runs_period_once')
      .on(t.tenantId, t.periodStart)
      .where(sql`${t.status} <> 'cancelled'`),
    foreignKey({
      name: 'payroll_runs_prepared_by_fk',
      columns: [t.tenantId, t.preparedBy],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'payroll_runs_approved_by_fk',
      columns: [t.tenantId, t.approvedBy],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'payroll_runs_paid_by_fk',
      columns: [t.tenantId, t.paidBy],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('restrict'),
    check('payroll_runs_period', sql`${t.periodEnd} >= ${t.periodStart}`),
    check(
      'payroll_runs_approver_differs',
      sql`${t.approvedBy} is null or ${t.approvedBy} <> ${t.preparedBy}`,
    ),
    check(
      'payroll_runs_state',
      sql`case ${t.status}
        when 'draft' then ${t.approvedBy} is null and ${t.paidBy} is null
        when 'approved' then ${t.approvedBy} is not null and ${t.approveEntryId} is not null and ${t.paidBy} is null
        when 'paid' then ${t.approvedBy} is not null and ${t.paidBy} is not null and ${t.payEntryId} is not null
        else ${t.cancelledAt} is not null
      end`,
    ),
    check(
      'payroll_runs_pay_method',
      sql`${t.payMethod} is null or ${t.payMethod} in ('cash','bank','upi','cheque','card')`,
    ),
    check(
      'payroll_runs_totals',
      sql`${t.grossTotal} >= 0 and ${t.deductionsTotal} >= 0 and ${t.netTotal} >= 0 and ${t.netTotal} = ${t.grossTotal} - ${t.deductionsTotal}`,
    ),
    index('payroll_runs_list_idx').on(t.tenantId, t.periodStart),
  ],
);

/**
 * One employee's pay for a run. The structure and the attendance counts are copied in, so a
 * later change to the structure never alters a payslip. Only editable while the run is a draft
 * (the database enforces that with a trigger).
 */
export const payslips = pgTable(
  'payslips',
  {
    id: id(),
    tenantId: tenantId(),
    runId: uuid('run_id').notNull(),
    employeeId: uuid('employee_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    employeeCode: text('employee_code').notNull(),
    employeeName: text('employee_name').notNull(),
    designation: text('designation'),
    basic: money('basic', 12).notNull(),
    hra: money('hra', 12).notNull(),
    allowance: money('allowance', 12).notNull(),
    daysInPeriod: smallint('days_in_period').notNull(),
    /** Paid days times two, so a half day is exact (7 = three and a half days). */
    paidHalfDays: smallint('paid_half_days').notNull(),
    presentDays: smallint('present_days').notNull().default(0),
    halfDays: smallint('half_days').notNull().default(0),
    leaveDays: smallint('leave_days').notNull().default(0),
    offDays: smallint('off_days').notNull().default(0),
    holidayDays: smallint('holiday_days').notNull().default(0),
    absentDays: smallint('absent_days').notNull().default(0),
    /** Days with punches but under half a day, or an "in" with no "out". They earn nothing. */
    shortDays: smallint('short_days').notNull().default(0),
    incompleteDays: smallint('incomplete_days').notNull().default(0),
    /** Monthly gross, before attendance. */
    fullGross: money('full_gross').notNull(),
    /** Gross for the paid days. */
    earned: money('earned').notNull(),
    bonus: money('bonus').notNull().default('0'),
    /** The fixed deduction from the salary structure, before any cap. */
    plannedDeductions: money('planned_deductions').notNull().default('0'),
    /** What was actually deducted. */
    deductions: money('deductions').notNull().default('0'),
    otherDeductions: money('other_deductions').notNull().default('0'),
    /** True when the deductions had to be cut down so that net pay is not negative. */
    deductionsCapped: smallint('deductions_capped').notNull().default(0),
    adjustmentNote: text('adjustment_note'),
    netPay: money('net_pay').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('payslips_run_employee_unique').on(t.tenantId, t.runId, t.employeeId),
    foreignKey({
      name: 'payslips_run_fk',
      columns: [t.tenantId, t.runId],
      foreignColumns: [payrollRuns.tenantId, payrollRuns.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'payslips_employee_fk',
      columns: [t.tenantId, t.employeeId],
      foreignColumns: [employees.tenantId, employees.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'payslips_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }).onDelete('restrict'),
    check(
      'payslips_days',
      sql`${t.paidHalfDays} >= 0 and ${t.paidHalfDays} <= ${t.daysInPeriod} * 2 and ${t.daysInPeriod} between 28 and 31`,
    ),
    check(
      'payslips_amounts',
      sql`${t.earned} >= 0 and ${t.bonus} >= 0 and ${t.deductions} >= 0 and ${t.otherDeductions} >= 0 and ${t.netPay} >= 0 and ${t.netPay} = ${t.earned} + ${t.bonus} - ${t.deductions} - ${t.otherDeductions}`,
    ),
    index('payslips_run_idx').on(t.tenantId, t.runId),
    index('payslips_employee_idx').on(t.tenantId, t.employeeId),
  ],
);
