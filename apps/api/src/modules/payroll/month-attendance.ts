import type { TenantTx } from '../../db/client';
import { buildDays, localDate } from '../hr/attendance.logic';
import * as attendanceRepo from '../hr/attendance.repository';
import * as calendarRepo from '../hr/calendar.repository';
import { countDays, type DayCounts } from './payroll.logic';

export interface AttendancePerson {
  employeeId: string;
  joiningDate: string;
  shiftId: string | null;
}

/**
 * Each person's attendance for a stretch of days, counted the way payroll pays it. Payroll and
 * the attendance report both come through here so they can never disagree about a day.
 */
export async function monthAttendance(
  tx: TenantTx,
  people: AttendancePerson[],
  period: { start: string; end: string },
  now: Date,
): Promise<Map<string, DayCounts>> {
  const { timeZone, weeklyOff } = await attendanceRepo.organisationCalendar(tx);
  const ids = people.map((p) => p.employeeId);
  const [punches, leave, shiftRows, holidayRows] = await Promise.all([
    attendanceRepo.punchesInRange(tx, ids, period.start, period.end, timeZone),
    attendanceRepo.approvedLeaveInRange(tx, ids, period.start, period.end),
    attendanceRepo.shiftsByIds(tx, [
      ...new Set(people.map((p) => p.shiftId).filter((x): x is string => !!x)),
    ]),
    calendarRepo.holidaysBetween(tx, period.start, period.end),
  ]);
  const holidays = new Map(holidayRows.map((h) => [h.holidayDate, h.name]));
  const shiftById = new Map(shiftRows.map((s) => [s.id, s]));
  const today = localDate(now, timeZone);

  return new Map(
    people.map((p) => {
      const shift = p.shiftId ? shiftById.get(p.shiftId) : undefined;
      const days = buildDays({
        from: period.start,
        to: period.end,
        today,
        joiningDate: p.joiningDate,
        punches: punches
          .filter((x) => x.employeeId === p.employeeId)
          .map((x) => ({ kind: x.kind, at: x.at })),
        leave: leave.filter((l) => l.employeeId === p.employeeId),
        shift: shift ?? null,
        timeZone,
        weeklyOff,
        holidays,
      });
      return [p.employeeId, countDays(days)] as const;
    }),
  );
}
