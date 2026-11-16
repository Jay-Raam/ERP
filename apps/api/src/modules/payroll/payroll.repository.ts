import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { TenantTx } from '../../db/client';
import {
  branches,
  employees,
  payrollRuns,
  payslips,
  salaryStructures,
  users,
} from '../../db/schema';

const money = (c: unknown) => sql<string>`${c}::text`;

// ------------------------------------------------------------ salary structures

export type StructureRow = {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  designation: string | null;
  status: 'active' | 'inactive';
  joiningDate: string;
  branch: { id: string; code: string; name: string };
  structureId: string | null;
  basic: string | null;
  hra: string | null;
  allowance: string | null;
  deductions: string | null;
  version: number | null;
};

const structureColumns = {
  employeeId: employees.id,
  employeeCode: employees.employeeCode,
  employeeName: employees.fullName,
  designation: employees.designation,
  status: employees.status,
  joiningDate: employees.joiningDate,
  branchId: branches.id,
  branchCode: branches.code,
  branchName: branches.name,
  structureId: salaryStructures.id,
  basic: money(salaryStructures.basic),
  hra: money(salaryStructures.hra),
  allowance: money(salaryStructures.allowance),
  deductions: money(salaryStructures.deductions),
  version: salaryStructures.version,
};

type RawStructure = Omit<StructureRow, 'branch'> & {
  branchId: string;
  branchCode: string;
  branchName: string;
};

function shapeStructure(r: RawStructure): StructureRow {
  const { branchId, branchCode, branchName, ...rest } = r;
  return { ...rest, branch: { id: branchId, code: branchCode, name: branchName } };
}

function structureBase(tx: TenantTx) {
  return tx
    .select(structureColumns)
    .from(employees)
    .innerJoin(branches, eq(branches.id, employees.branchId))
    .leftJoin(salaryStructures, eq(salaryStructures.employeeId, employees.id));
}

export async function listStructures(
  tx: TenantTx,
  f: { search?: string; branchId?: string; missingOnly: boolean; limit: number; offset: number },
) {
  const where: SQL[] = [eq(employees.status, 'active')];
  if (f.branchId) where.push(eq(employees.branchId, f.branchId));
  if (f.missingOnly) where.push(isNull(salaryStructures.id));
  if (f.search) {
    const like = `%${f.search.replace(/[\\%_]/g, '\\$&')}%`;
    where.push(or(ilike(employees.fullName, like), ilike(employees.employeeCode, like))!);
  }
  const [rows, [total]] = await Promise.all([
    structureBase(tx)
      .where(and(...where))
      .orderBy(asc(employees.employeeCode))
      .limit(f.limit)
      .offset(f.offset),
    tx
      .select({ n: count() })
      .from(employees)
      .leftJoin(salaryStructures, eq(salaryStructures.employeeId, employees.id))
      .where(and(...where)),
  ]);
  return { items: rows.map(shapeStructure), total: total?.n ?? 0 };
}

export async function findStructureRow(tx: TenantTx, employeeId: string) {
  const [row] = await structureBase(tx).where(eq(employees.id, employeeId));
  return row ? shapeStructure(row) : null;
}

export async function insertStructure(
  tx: TenantTx,
  v: {
    tenantId: string;
    employeeId: string;
    basic: string;
    hra: string;
    allowance: string;
    deductions: string;
  },
) {
  await tx.insert(salaryStructures).values(v);
}

/** Version-checked update; false when someone else changed the row first. */
export async function updateStructure(
  tx: TenantTx,
  employeeId: string,
  version: number,
  v: { basic: string; hra: string; allowance: string; deductions: string },
): Promise<boolean> {
  const rows = await tx
    .update(salaryStructures)
    .set({ ...v, updatedAt: sql`now()`, version: sql`${salaryStructures.version} + 1` })
    .where(and(eq(salaryStructures.employeeId, employeeId), eq(salaryStructures.version, version)))
    .returning({ id: salaryStructures.id });
  return rows.length === 1;
}

/** Active employees employed by `periodEnd`, with their structure if they have one. */
export async function payableEmployees(tx: TenantTx, periodEnd: string) {
  const rows = await tx
    .select({
      ...structureColumns,
      shiftId: employees.shiftId,
    })
    .from(employees)
    .innerJoin(branches, eq(branches.id, employees.branchId))
    .leftJoin(salaryStructures, eq(salaryStructures.employeeId, employees.id))
    .where(and(eq(employees.status, 'active'), sql`${employees.joiningDate} <= ${periodEnd}::date`))
    .orderBy(asc(employees.employeeCode));
  return rows.map((r) => ({ ...shapeStructure(r), shiftId: r.shiftId }));
}

// ----------------------------------------------------------------- payroll runs

const preparedUser = alias(users, 'prepared_user');
const approvedUser = alias(users, 'approved_user');
const paidUser = alias(users, 'paid_user');

export type RunRow = {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: 'draft' | 'approved' | 'paid' | 'cancelled';
  notes: string | null;
  employeeCount: number;
  grossTotal: string;
  deductionsTotal: string;
  netTotal: string;
  version: number;
  createdAt: Date;
  preparedBy: string;
  preparedByName: string;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: Date | null;
  paidByName: string | null;
  paidAt: Date | null;
  paidOn: string | null;
  payMethod: string | null;
  payReference: string | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  approveEntryId: string | null;
  payEntryId: string | null;
  cancelEntryId: string | null;
};

const runColumns = {
  id: payrollRuns.id,
  periodStart: payrollRuns.periodStart,
  periodEnd: payrollRuns.periodEnd,
  status: payrollRuns.status,
  notes: payrollRuns.notes,
  employeeCount: payrollRuns.employeeCount,
  grossTotal: money(payrollRuns.grossTotal),
  deductionsTotal: money(payrollRuns.deductionsTotal),
  netTotal: money(payrollRuns.netTotal),
  version: payrollRuns.version,
  createdAt: payrollRuns.createdAt,
  preparedBy: payrollRuns.preparedBy,
  preparedByName: preparedUser.fullName,
  approvedBy: payrollRuns.approvedBy,
  approvedByName: approvedUser.fullName,
  approvedAt: payrollRuns.approvedAt,
  paidByName: paidUser.fullName,
  paidAt: payrollRuns.paidAt,
  paidOn: payrollRuns.paidOn,
  payMethod: payrollRuns.payMethod,
  payReference: payrollRuns.payReference,
  cancelledAt: payrollRuns.cancelledAt,
  cancelReason: payrollRuns.cancelReason,
  approveEntryId: payrollRuns.approveEntryId,
  payEntryId: payrollRuns.payEntryId,
  cancelEntryId: payrollRuns.cancelEntryId,
};

function runBase(tx: TenantTx) {
  return tx
    .select(runColumns)
    .from(payrollRuns)
    .innerJoin(preparedUser, eq(preparedUser.id, payrollRuns.preparedBy))
    .leftJoin(approvedUser, eq(approvedUser.id, payrollRuns.approvedBy))
    .leftJoin(paidUser, eq(paidUser.id, payrollRuns.paidBy));
}

export async function listRuns(
  tx: TenantTx,
  f: { status?: RunRow['status']; limit: number; offset: number },
) {
  const where = f.status ? eq(payrollRuns.status, f.status) : undefined;
  const [items, [total]] = await Promise.all([
    runBase(tx)
      .where(where)
      .orderBy(desc(payrollRuns.periodStart), desc(payrollRuns.createdAt))
      .limit(f.limit)
      .offset(f.offset),
    tx.select({ n: count() }).from(payrollRuns).where(where),
  ]);
  return { items: items as RunRow[], total: total?.n ?? 0 };
}

export async function findRun(tx: TenantTx, id: string): Promise<RunRow | null> {
  const [row] = await runBase(tx).where(eq(payrollRuns.id, id));
  return (row as RunRow | undefined) ?? null;
}

/** Takes the row lock; every state change starts here, so two people cannot approve and cancel at once. */
export async function lockRun(tx: TenantTx, id: string) {
  const rows = await tx.execute(
    sql`select id, status, version, prepared_by as "preparedBy", period_start::text as "periodStart", period_end::text as "periodEnd" from payroll_runs where id = ${id} for update`,
  );
  return (
    (rows[0] as
      | {
          id: string;
          status: RunRow['status'];
          version: number;
          preparedBy: string;
          periodStart: string;
          periodEnd: string;
        }
      | undefined) ?? null
  );
}

export async function insertRun(
  tx: TenantTx,
  v: {
    tenantId: string;
    periodStart: string;
    periodEnd: string;
    notes: string | null;
    preparedBy: string;
  },
): Promise<string> {
  const [row] = await tx.insert(payrollRuns).values(v).returning({ id: payrollRuns.id });
  return row!.id;
}

/** Recomputes the run's totals from its payslips and bumps the version. */
export async function refreshRunTotals(tx: TenantTx, runId: string): Promise<void> {
  await tx.execute(sql`
    update payroll_runs r set
      employee_count = t.n,
      gross_total = t.gross,
      deductions_total = t.ded,
      net_total = t.net,
      updated_at = now(),
      version = r.version + 1
    from (
      select count(*)::int as n,
             coalesce(sum(earned + bonus), 0) as gross,
             coalesce(sum(deductions + other_deductions), 0) as ded,
             coalesce(sum(net_pay), 0) as net
      from payslips where run_id = ${runId}
    ) t
    where r.id = ${runId}`);
}

export async function setApproved(
  tx: TenantTx,
  id: string,
  v: { approvedBy: string; entryId: string },
) {
  await tx
    .update(payrollRuns)
    .set({
      status: 'approved',
      approvedBy: v.approvedBy,
      approvedAt: sql`now()`,
      approveEntryId: v.entryId,
      updatedAt: sql`now()`,
      version: sql`${payrollRuns.version} + 1`,
    })
    .where(eq(payrollRuns.id, id));
}

export async function setPaid(
  tx: TenantTx,
  id: string,
  v: {
    paidBy: string;
    paidOn: string;
    method: string;
    reference: string | null;
    entryId: string;
  },
) {
  await tx
    .update(payrollRuns)
    .set({
      status: 'paid',
      paidBy: v.paidBy,
      paidAt: sql`now()`,
      paidOn: v.paidOn,
      payMethod: v.method,
      payReference: v.reference,
      payEntryId: v.entryId,
      updatedAt: sql`now()`,
      version: sql`${payrollRuns.version} + 1`,
    })
    .where(eq(payrollRuns.id, id));
}

export async function setCancelled(
  tx: TenantTx,
  id: string,
  v: { cancelledBy: string; reason: string; entryId: string | null },
) {
  await tx
    .update(payrollRuns)
    .set({
      status: 'cancelled',
      cancelledBy: v.cancelledBy,
      cancelledAt: sql`now()`,
      cancelReason: v.reason,
      cancelEntryId: v.entryId,
      updatedAt: sql`now()`,
      version: sql`${payrollRuns.version} + 1`,
    })
    .where(eq(payrollRuns.id, id));
}

// --------------------------------------------------------------------- payslips

export type PayslipRow = {
  id: string;
  runId: string;
  employeeId: string;
  branchId: string;
  employeeCode: string;
  employeeName: string;
  designation: string | null;
  basic: string;
  hra: string;
  allowance: string;
  daysInPeriod: number;
  paidHalfDays: number;
  presentDays: number;
  halfDays: number;
  leaveDays: number;
  offDays: number;
  holidayDays: number;
  absentDays: number;
  shortDays: number;
  incompleteDays: number;
  fullGross: string;
  earned: string;
  bonus: string;
  plannedDeductions: string;
  deductions: string;
  otherDeductions: string;
  deductionsCapped: boolean;
  adjustmentNote: string | null;
  netPay: string;
};

const payslipColumns = {
  id: payslips.id,
  runId: payslips.runId,
  employeeId: payslips.employeeId,
  branchId: payslips.branchId,
  employeeCode: payslips.employeeCode,
  employeeName: payslips.employeeName,
  designation: payslips.designation,
  basic: money(payslips.basic),
  hra: money(payslips.hra),
  allowance: money(payslips.allowance),
  daysInPeriod: payslips.daysInPeriod,
  paidHalfDays: payslips.paidHalfDays,
  presentDays: payslips.presentDays,
  halfDays: payslips.halfDays,
  leaveDays: payslips.leaveDays,
  offDays: payslips.offDays,
  holidayDays: payslips.holidayDays,
  absentDays: payslips.absentDays,
  shortDays: payslips.shortDays,
  incompleteDays: payslips.incompleteDays,
  fullGross: money(payslips.fullGross),
  earned: money(payslips.earned),
  bonus: money(payslips.bonus),
  plannedDeductions: money(payslips.plannedDeductions),
  deductions: money(payslips.deductions),
  otherDeductions: money(payslips.otherDeductions),
  deductionsCapped: sql<boolean>`${payslips.deductionsCapped} = 1`,
  adjustmentNote: payslips.adjustmentNote,
  netPay: money(payslips.netPay),
};

export async function insertPayslips(
  tx: TenantTx,
  rows: (typeof payslips.$inferInsert)[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx.insert(payslips).values(rows);
}

export async function deletePayslips(tx: TenantTx, runId: string): Promise<void> {
  await tx.delete(payslips).where(eq(payslips.runId, runId));
}

export async function listPayslips(
  tx: TenantTx,
  f: { runId: string; search?: string; limit: number; offset: number },
) {
  const where: SQL[] = [eq(payslips.runId, f.runId)];
  if (f.search) {
    const like = `%${f.search.replace(/[\\%_]/g, '\\$&')}%`;
    where.push(or(ilike(payslips.employeeName, like), ilike(payslips.employeeCode, like))!);
  }
  const [items, [total]] = await Promise.all([
    tx
      .select(payslipColumns)
      .from(payslips)
      .where(and(...where))
      .orderBy(asc(payslips.employeeCode))
      .limit(f.limit)
      .offset(f.offset),
    tx
      .select({ n: count() })
      .from(payslips)
      .where(and(...where)),
  ]);
  return { items: items as PayslipRow[], total: total?.n ?? 0 };
}

/** Every payslip of a run, used to carry adjustments over on a recalculation. */
export async function allPayslips(tx: TenantTx, runId: string): Promise<PayslipRow[]> {
  return (await tx
    .select(payslipColumns)
    .from(payslips)
    .where(eq(payslips.runId, runId))) as PayslipRow[];
}

export async function findPayslip(tx: TenantTx, id: string): Promise<PayslipRow | null> {
  const [row] = await tx.select(payslipColumns).from(payslips).where(eq(payslips.id, id));
  return (row as PayslipRow | undefined) ?? null;
}

export async function updatePayslipPay(
  tx: TenantTx,
  id: string,
  v: {
    bonus: string;
    otherDeductions: string;
    deductions: string;
    capped: boolean;
    note: string | null;
    netPay: string;
  },
) {
  await tx
    .update(payslips)
    .set({
      bonus: v.bonus,
      otherDeductions: v.otherDeductions,
      deductions: v.deductions,
      deductionsCapped: v.capped ? 1 : 0,
      adjustmentNote: v.note,
      netPay: v.netPay,
    })
    .where(eq(payslips.id, id));
}

export async function payslipRunId(tx: TenantTx, id: string): Promise<string | null> {
  const [row] = await tx
    .select({ runId: payslips.runId })
    .from(payslips)
    .where(eq(payslips.id, id));
  return row?.runId ?? null;
}

export type MyPayslipRow = PayslipRow & {
  periodStart: string;
  periodEnd: string;
  runStatus: RunRow['status'];
  paidOn: string | null;
};

/** One employee's payslips from approved or paid runs, newest first. */
export async function myPayslips(
  tx: TenantTx,
  employeeId: string,
  f: { limit: number; offset: number },
) {
  const where = and(
    eq(payslips.employeeId, employeeId),
    inArray(payrollRuns.status, ['approved', 'paid']),
  );
  const [items, [total]] = await Promise.all([
    tx
      .select({
        ...payslipColumns,
        periodStart: payrollRuns.periodStart,
        periodEnd: payrollRuns.periodEnd,
        runStatus: payrollRuns.status,
        paidOn: payrollRuns.paidOn,
      })
      .from(payslips)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
      .where(where)
      .orderBy(desc(payrollRuns.periodStart))
      .limit(f.limit)
      .offset(f.offset),
    tx
      .select({ n: count() })
      .from(payslips)
      .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.runId))
      .where(where),
  ]);
  return { items: items as MyPayslipRow[], total: total?.n ?? 0 };
}
