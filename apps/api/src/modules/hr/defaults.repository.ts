import type { TenantTx } from '../../db/client';
import { leaveTypes, shifts } from '../../db/schema';

export const DEFAULT_SHIFT = {
  name: 'General',
  startTime: '09:00',
  endTime: '18:00',
  graceMinutes: 15,
  fullDayMinutes: 480,
  halfDayMinutes: 240,
} as const;

export const DEFAULT_LEAVE_TYPES = [
  { code: 'CL', name: 'Casual leave', annualDays: 12, paid: true },
  { code: 'SL', name: 'Sick leave', annualDays: 12, paid: true },
  { code: 'EL', name: 'Earned leave', annualDays: 15, paid: true },
] as const;

/**
 * Idempotent: adds the starter shift and leave types if the organisation has
 * none yet. Safe to call at registration, in the seed, and lazily for
 * organisations created before HR existed.
 */
export async function ensureHrDefaults(tx: TenantTx, tenantId: string): Promise<void> {
  const existingShift = await tx.select({ id: shifts.id }).from(shifts).limit(1);
  if (existingShift.length === 0) {
    await tx
      .insert(shifts)
      .values({ tenantId, ...DEFAULT_SHIFT })
      .onConflictDoNothing();
  }
  const existingTypes = await tx.select({ id: leaveTypes.id }).from(leaveTypes).limit(1);
  if (existingTypes.length === 0) {
    await tx
      .insert(leaveTypes)
      .values(DEFAULT_LEAVE_TYPES.map((t) => ({ tenantId, ...t })))
      .onConflictDoNothing();
  }
}
