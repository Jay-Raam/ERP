import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { TenantTx } from '../../db/client';
import { scopeCondition } from './scope.repository';
import type { Scope } from './scope';
import { employees, leaveRequests, leaveTypes } from '../../db/schema';

// -------------------------------------------------------------- leave types

export interface LeaveTypeRow {
  id: string;
  code: string;
  name: string;
  annualDays: number;
  paid: boolean;
  status: 'active' | 'inactive';
  version: number;
}

const typeColumns = {
  id: leaveTypes.id,
  code: leaveTypes.code,
  name: leaveTypes.name,
  annualDays: leaveTypes.annualDays,
  paid: leaveTypes.paid,
  status: leaveTypes.status,
  version: leaveTypes.version,
};

export const listLeaveTypes = (tx: TenantTx): Promise<LeaveTypeRow[]> =>
  tx.select(typeColumns).from(leaveTypes).orderBy(asc(leaveTypes.name));

export async function findLeaveType(tx: TenantTx, id: string): Promise<LeaveTypeRow | null> {
  const [row] = await tx.select(typeColumns).from(leaveTypes).where(eq(leaveTypes.id, id)).limit(1);
  return row ?? null;
}

export async function insertLeaveType(
  tx: TenantTx,
  values: { tenantId: string; code: string; name: string; annualDays: number; paid: boolean },
): Promise<string> {
  const [row] = await tx.insert(leaveTypes).values(values).returning({ id: leaveTypes.id });
  return row!.id;
}

export async function updateLeaveType(
  tx: TenantTx,
  id: string,
  version: number,
  values: { name: string; annualDays: number; paid: boolean; status: 'active' | 'inactive' },
): Promise<boolean> {
  const rows = await tx
    .update(leaveTypes)
    .set({ ...values, version: sql`${leaveTypes.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(leaveTypes.id, id), eq(leaveTypes.version, version)))
    .returning({ id: leaveTypes.id });
  return rows.length === 1;
}

// ----------------------------------------------------------------- requests

export interface LeaveRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  branchId: string;
  userId: string | null;
  leaveTypeId: string;
  leaveTypeName: string;
  leaveTypeCode: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
  version: number;
}

const requestColumns = {
  id: leaveRequests.id,
  employeeId: leaveRequests.employeeId,
  employeeName: employees.fullName,
  employeeCode: employees.employeeCode,
  branchId: employees.branchId,
  userId: employees.userId,
  leaveTypeId: leaveRequests.leaveTypeId,
  leaveTypeName: leaveTypes.name,
  leaveTypeCode: leaveTypes.code,
  startDate: leaveRequests.startDate,
  endDate: leaveRequests.endDate,
  days: leaveRequests.days,
  reason: leaveRequests.reason,
  status: leaveRequests.status,
  decidedAt: leaveRequests.decidedAt,
  decisionNote: leaveRequests.decisionNote,
  createdAt: leaveRequests.createdAt,
  version: leaveRequests.version,
};

function base(tx: TenantTx) {
  return tx
    .select(requestColumns)
    .from(leaveRequests)
    .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId));
}

export async function listLeave(
  tx: TenantTx,
  filter: {
    scope: Scope;
    status?: LeaveRow['status'];
    employeeId?: string;
    limit: number;
    offset: number;
  },
): Promise<{ items: LeaveRow[]; total: number }> {
  const where = and(
    scopeCondition(filter.scope, { branchId: employees.branchId, userId: employees.userId }),
    filter.status ? eq(leaveRequests.status, filter.status) : undefined,
    filter.employeeId ? eq(leaveRequests.employeeId, filter.employeeId) : undefined,
  );
  const items = await base(tx)
    .where(where)
    .orderBy(desc(leaveRequests.createdAt), asc(leaveRequests.id))
    .limit(filter.limit)
    .offset(filter.offset);
  const [count] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(leaveRequests)
    .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
    .where(where);
  return { items, total: count!.n };
}

export async function findLeave(tx: TenantTx, id: string): Promise<LeaveRow | null> {
  const [row] = await base(tx).where(eq(leaveRequests.id, id)).limit(1);
  return row ?? null;
}

/** Row lock on a request. Lock the employee first, always, to keep lock order the same. */
export async function lockLeave(tx: TenantTx, id: string) {
  const [row] = await tx
    .select({
      id: leaveRequests.id,
      employeeId: leaveRequests.employeeId,
      status: leaveRequests.status,
      version: leaveRequests.version,
      leaveTypeId: leaveRequests.leaveTypeId,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      days: leaveRequests.days,
    })
    .from(leaveRequests)
    .where(eq(leaveRequests.id, id))
    .limit(1)
    .for('update');
  return row ?? null;
}

export async function insertLeave(
  tx: TenantTx,
  values: {
    tenantId: string;
    employeeId: string;
    leaveTypeId: string;
    startDate: string;
    endDate: string;
    days: number;
    reason: string;
  },
): Promise<string> {
  const [row] = await tx.insert(leaveRequests).values(values).returning({ id: leaveRequests.id });
  return row!.id;
}

export async function decideLeave(
  tx: TenantTx,
  id: string,
  version: number,
  values: {
    status: 'approved' | 'rejected' | 'cancelled';
    decidedBy: string | null;
    note: string | null;
  },
): Promise<boolean> {
  const rows = await tx
    .update(leaveRequests)
    .set({
      status: values.status,
      decidedBy: values.decidedBy,
      decidedAt: sql`now()`,
      decisionNote: values.note,
      version: sql`${leaveRequests.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(leaveRequests.id, id), eq(leaveRequests.version, version)))
    .returning({ id: leaveRequests.id });
  return rows.length === 1;
}

/** Pending or approved leave that touches [start, end] for this employee. */
export async function findOverlap(
  tx: TenantTx,
  employeeId: string,
  start: string,
  end: string,
  excludeId?: string,
) {
  const [row] = await tx
    .select({ id: leaveRequests.id })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.employeeId, employeeId),
        inArray(leaveRequests.status, ['pending', 'approved']),
        sql`${leaveRequests.startDate} <= ${end}::date`,
        sql`${leaveRequests.endDate} >= ${start}::date`,
        excludeId ? ne(leaveRequests.id, excludeId) : undefined,
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Days taken (approved) and reserved (pending) in a calendar year, per leave type. */
export async function usageForYear(tx: TenantTx, employeeId: string, year: number) {
  return tx
    .select({
      leaveTypeId: leaveRequests.leaveTypeId,
      status: leaveRequests.status,
      days: sql<number>`coalesce(sum(${leaveRequests.days}), 0)::float8`,
    })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.employeeId, employeeId),
        inArray(leaveRequests.status, ['pending', 'approved']),
        sql`extract(year from ${leaveRequests.startDate}) = ${year}`,
      ),
    )
    .groupBy(leaveRequests.leaveTypeId, leaveRequests.status);
}
