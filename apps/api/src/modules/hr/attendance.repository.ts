import { and, asc, desc, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { TenantTx } from '../../db/client';
import {
  attendancePunches,
  employees,
  leaveRequests,
  organisations,
  shifts,
} from '../../db/schema';

export type PunchRow = {
  id: string;
  employeeId: string;
  kind: 'in' | 'out';
  source: 'self' | 'manual';
  at: Date;
  note: string | null;
};

const punchColumns = {
  id: attendancePunches.id,
  employeeId: attendancePunches.employeeId,
  kind: attendancePunches.kind,
  source: attendancePunches.source,
  at: attendancePunches.punchedAt,
  note: attendancePunches.note,
};

export async function organisationZone(tx: TenantTx): Promise<string> {
  return (await organisationCalendar(tx)).timeZone;
}

export async function organisationCalendar(tx: TenantTx) {
  const [row] = await tx
    .select({ tz: organisations.timezone, off: organisations.weeklyOffDays })
    .from(organisations)
    .limit(1);
  return { timeZone: row?.tz ?? 'Asia/Kolkata', weeklyOff: row?.off ?? [0] };
}

export async function lastPunch(tx: TenantTx, employeeId: string): Promise<PunchRow | null> {
  const [row] = await tx
    .select(punchColumns)
    .from(attendancePunches)
    .where(eq(attendancePunches.employeeId, employeeId))
    .orderBy(desc(attendancePunches.punchedAt))
    .limit(1);
  return row ?? null;
}

export async function punchBefore(tx: TenantTx, employeeId: string, at: Date) {
  const [row] = await tx
    .select(punchColumns)
    .from(attendancePunches)
    .where(and(eq(attendancePunches.employeeId, employeeId), lt(attendancePunches.punchedAt, at)))
    .orderBy(desc(attendancePunches.punchedAt))
    .limit(1);
  return row ?? null;
}

export async function punchAfter(tx: TenantTx, employeeId: string, at: Date) {
  const [row] = await tx
    .select(punchColumns)
    .from(attendancePunches)
    .where(and(eq(attendancePunches.employeeId, employeeId), gt(attendancePunches.punchedAt, at)))
    .orderBy(asc(attendancePunches.punchedAt))
    .limit(1);
  return row ?? null;
}

export async function insertPunch(
  tx: TenantTx,
  values: {
    tenantId: string;
    employeeId: string;
    branchId: string;
    punchedAt: Date;
    kind: 'in' | 'out';
    source: 'self' | 'manual';
    note: string | null;
    createdBy: string;
  },
): Promise<void> {
  await tx.insert(attendancePunches).values(values);
}

/** Punches whose local day falls in [from, to], for the given employees, oldest first. */
export async function punchesInRange(
  tx: TenantTx,
  employeeIds: string[],
  from: string,
  to: string,
  timeZone: string,
): Promise<PunchRow[]> {
  if (employeeIds.length === 0) return [];
  return tx
    .select(punchColumns)
    .from(attendancePunches)
    .where(
      and(
        inArray(attendancePunches.employeeId, employeeIds),
        sql`${attendancePunches.punchedAt} >= (${from}::date)::timestamp AT TIME ZONE ${timeZone}`,
        sql`${attendancePunches.punchedAt} < ((${to}::date + 1))::timestamp AT TIME ZONE ${timeZone}`,
      ),
    )
    .orderBy(asc(attendancePunches.employeeId), asc(attendancePunches.punchedAt));
}

export async function approvedLeaveInRange(
  tx: TenantTx,
  employeeIds: string[],
  from: string,
  to: string,
) {
  if (employeeIds.length === 0) return [];
  return tx
    .select({
      employeeId: leaveRequests.employeeId,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
    })
    .from(leaveRequests)
    .where(
      and(
        inArray(leaveRequests.employeeId, employeeIds),
        eq(leaveRequests.status, 'approved'),
        sql`${leaveRequests.startDate} <= ${to}::date`,
        sql`${leaveRequests.endDate} >= ${from}::date`,
      ),
    );
}

export async function shiftsByIds(tx: TenantTx, ids: string[]) {
  if (ids.length === 0) return [];
  return tx
    .select({
      id: shifts.id,
      startTime: shifts.startTime,
      graceMinutes: shifts.graceMinutes,
      fullDayMinutes: shifts.fullDayMinutes,
      halfDayMinutes: shifts.halfDayMinutes,
    })
    .from(shifts)
    .where(inArray(shifts.id, ids));
}

export async function employeeShiftIds(tx: TenantTx, employeeIds: string[]) {
  if (employeeIds.length === 0) return [];
  return tx
    .select({ id: employees.id, shiftId: employees.shiftId })
    .from(employees)
    .where(inArray(employees.id, employeeIds));
}

// ----------------------------------------------------------------- shifts

export interface ShiftRow {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  fullDayMinutes: number;
  halfDayMinutes: number;
  status: 'active' | 'inactive';
  version: number;
}

const shiftColumns = {
  id: shifts.id,
  name: shifts.name,
  startTime: shifts.startTime,
  endTime: shifts.endTime,
  graceMinutes: shifts.graceMinutes,
  fullDayMinutes: shifts.fullDayMinutes,
  halfDayMinutes: shifts.halfDayMinutes,
  status: shifts.status,
  version: shifts.version,
};

export const listShifts = (tx: TenantTx): Promise<ShiftRow[]> =>
  tx.select(shiftColumns).from(shifts).orderBy(asc(shifts.name));

export async function findShift(tx: TenantTx, id: string): Promise<ShiftRow | null> {
  const [row] = await tx.select(shiftColumns).from(shifts).where(eq(shifts.id, id)).limit(1);
  return row ?? null;
}

export async function insertShift(
  tx: TenantTx,
  values: {
    tenantId: string;
    name: string;
    startTime: string;
    endTime: string;
    graceMinutes: number;
    fullDayMinutes: number;
    halfDayMinutes: number;
  },
): Promise<string> {
  const [row] = await tx.insert(shifts).values(values).returning({ id: shifts.id });
  return row!.id;
}

export async function updateShift(
  tx: TenantTx,
  id: string,
  version: number,
  values: {
    name: string;
    startTime: string;
    endTime: string;
    graceMinutes: number;
    fullDayMinutes: number;
    halfDayMinutes: number;
    status: 'active' | 'inactive';
  },
): Promise<boolean> {
  const rows = await tx
    .update(shifts)
    .set({ ...values, version: sql`${shifts.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(shifts.id, id), eq(shifts.version, version)))
    .returning({ id: shifts.id });
  return rows.length === 1;
}
