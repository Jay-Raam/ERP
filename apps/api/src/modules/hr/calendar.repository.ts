import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import type { TenantTx } from '../../db/client';
import { holidays, organisations } from '../../db/schema';

export type HolidayRow = {
  id: string;
  holidayDate: string;
  name: string;
  version: number;
};

const columns = {
  id: holidays.id,
  holidayDate: holidays.holidayDate,
  name: holidays.name,
  version: holidays.version,
};

export async function setWeeklyOff(tx: TenantTx, tenantId: string, days: number[]): Promise<void> {
  await tx
    .update(organisations)
    .set({ weeklyOffDays: days, updatedAt: sql`now()` })
    .where(eq(organisations.id, tenantId));
}

export async function holidaysBetween(
  tx: TenantTx,
  from: string,
  to: string,
): Promise<HolidayRow[]> {
  return tx
    .select(columns)
    .from(holidays)
    .where(and(gte(holidays.holidayDate, from), lte(holidays.holidayDate, to)))
    .orderBy(asc(holidays.holidayDate));
}

export async function findHoliday(tx: TenantTx, id: string): Promise<HolidayRow | null> {
  const [row] = await tx.select(columns).from(holidays).where(eq(holidays.id, id)).limit(1);
  return row ?? null;
}

export async function insertHoliday(
  tx: TenantTx,
  values: { tenantId: string; holidayDate: string; name: string },
): Promise<string> {
  const [row] = await tx.insert(holidays).values(values).returning({ id: holidays.id });
  return row!.id;
}

/** Returns false when the version is stale (someone else saved first). */
export async function updateHoliday(
  tx: TenantTx,
  id: string,
  version: number,
  values: { holidayDate: string; name: string },
): Promise<boolean> {
  const rows = await tx
    .update(holidays)
    .set({ ...values, version: sql`${holidays.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(holidays.id, id), eq(holidays.version, version)))
    .returning({ id: holidays.id });
  return rows.length > 0;
}

export async function deleteHoliday(tx: TenantTx, id: string): Promise<boolean> {
  const rows = await tx.delete(holidays).where(eq(holidays.id, id)).returning({ id: holidays.id });
  return rows.length > 0;
}
