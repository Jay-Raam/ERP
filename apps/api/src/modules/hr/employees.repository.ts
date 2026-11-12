import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import type { TenantTx } from '../../db/client';
import { scopeCondition } from './scope.repository';
import type { Scope } from './scope';
import { branches, employees, shifts, users } from '../../db/schema';

export interface EmployeeRow {
  id: string;
  employeeCode: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  department: string | null;
  designation: string | null;
  joiningDate: string;
  status: 'active' | 'inactive';
  version: number;
  createdAt: Date;
  branchId: string;
  branch: { id: string; code: string; name: string };
  shiftId: string | null;
  shiftName: string | null;
  userId: string | null;
  userEmail: string | null;
}

const columns = {
  id: employees.id,
  employeeCode: employees.employeeCode,
  fullName: employees.fullName,
  email: employees.email,
  phone: employees.phone,
  department: employees.department,
  designation: employees.designation,
  joiningDate: employees.joiningDate,
  status: employees.status,
  version: employees.version,
  createdAt: employees.createdAt,
  branchId: employees.branchId,
  branchCode: branches.code,
  branchName: branches.name,
  shiftId: employees.shiftId,
  shiftName: shifts.name,
  userId: employees.userId,
  userEmail: users.email,
};

type Raw = Omit<EmployeeRow, 'branch'> & { branchCode: string; branchName: string };

function shape(r: Raw): EmployeeRow {
  const { branchCode, branchName, ...rest } = r;
  return { ...rest, branch: { id: r.branchId, code: branchCode, name: branchName } };
}

function base(tx: TenantTx) {
  return tx
    .select(columns)
    .from(employees)
    .innerJoin(branches, eq(branches.id, employees.branchId))
    .leftJoin(shifts, eq(shifts.id, employees.shiftId))
    .leftJoin(users, eq(users.id, employees.userId));
}

export async function findBranch(tx: TenantTx, id: string) {
  const [row] = await tx
    .select({ id: branches.id, status: branches.status })
    .from(branches)
    .where(eq(branches.id, id))
    .limit(1);
  return row ?? null;
}

export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listEmployees(
  tx: TenantTx,
  filter: {
    scope: Scope;
    search?: string;
    status?: 'active' | 'inactive';
    branchId?: string;
    limit: number;
    offset: number;
  },
) {
  const where = and(
    scopeCondition(filter.scope, { branchId: employees.branchId, userId: employees.userId }),
    filter.search
      ? or(
          ilike(employees.fullName, likePattern(filter.search)),
          ilike(employees.employeeCode, likePattern(filter.search)),
          ilike(employees.email, likePattern(filter.search)),
        )
      : undefined,
    filter.status ? eq(employees.status, filter.status) : undefined,
    filter.branchId ? eq(employees.branchId, filter.branchId) : undefined,
  );
  const rows = await base(tx)
    .where(where)
    .orderBy(asc(employees.fullName), asc(employees.id))
    .limit(filter.limit)
    .offset(filter.offset);
  const [count] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(employees)
    .where(where);
  return { items: rows.map(shape), total: count!.n };
}

export async function findEmployee(tx: TenantTx, id: string): Promise<EmployeeRow | null> {
  const [row] = await base(tx).where(eq(employees.id, id)).limit(1);
  return row ? shape(row) : null;
}

export async function findEmployeeByUser(tx: TenantTx, userId: string) {
  const [row] = await base(tx).where(eq(employees.userId, userId)).limit(1);
  return row ? shape(row) : null;
}

/** Row lock for read-modify-write. */
export async function lockEmployee(tx: TenantTx, id: string) {
  const [row] = await tx
    .select({
      id: employees.id,
      branchId: employees.branchId,
      userId: employees.userId,
      shiftId: employees.shiftId,
      status: employees.status,
      version: employees.version,
    })
    .from(employees)
    .where(eq(employees.id, id))
    .limit(1)
    .for('update');
  return row ?? null;
}

export interface EmployeeValues {
  fullName: string;
  email: string | null;
  phone: string | null;
  branchId: string;
  department: string | null;
  designation: string | null;
  joiningDate: string;
  shiftId: string | null;
  userId: string | null;
}

export async function insertEmployee(
  tx: TenantTx,
  values: EmployeeValues & { tenantId: string; employeeCode: string },
): Promise<string> {
  const [row] = await tx.insert(employees).values(values).returning({ id: employees.id });
  return row!.id;
}

export async function updateEmployee(
  tx: TenantTx,
  id: string,
  version: number,
  values: EmployeeValues & { status: 'active' | 'inactive' },
): Promise<boolean> {
  const rows = await tx
    .update(employees)
    .set({ ...values, version: sql`${employees.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(employees.id, id), eq(employees.version, version)))
    .returning({ id: employees.id });
  return rows.length === 1;
}

export async function findActiveShift(tx: TenantTx, id: string) {
  const [row] = await tx
    .select({ id: shifts.id, status: shifts.status })
    .from(shifts)
    .where(eq(shifts.id, id))
    .limit(1);
  return row ?? null;
}

export async function findUserRef(tx: TenantTx, id: string) {
  const [row] = await tx
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return row ?? null;
}
