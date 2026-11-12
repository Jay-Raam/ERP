import { describe, expect, it } from 'vitest';
import {
  createHolidayInputSchema,
  workCalendarInputSchema,
  attendanceRangeInputSchema,
  createEmployeeInputSchema,
  createShiftInputSchema,
  daysInclusive,
  manualPunchInputSchema,
  requestLeaveInputSchema,
} from './index';

const BRANCH = '5f1c8f64-6a0e-4a5f-9a3f-2b1f0e7a9c11';

describe('createEmployeeInputSchema', () => {
  const base = {
    employeeCode: ' emp-001 ',
    fullName: '  Meena   Iyer ',
    branchId: BRANCH,
    joiningDate: '2026-04-01',
  };

  it('normalises and fills optional fields with null', () => {
    expect(createEmployeeInputSchema.parse(base)).toEqual({
      employeeCode: 'EMP-001',
      fullName: 'Meena Iyer',
      email: null,
      phone: null,
      branchId: BRANCH,
      department: null,
      designation: null,
      joiningDate: '2026-04-01',
      shiftId: null,
      userId: null,
    });
  });

  it('treats blank optional text as not set and cleans a phone number', () => {
    const parsed = createEmployeeInputSchema.parse({
      ...base,
      email: '  ',
      phone: '+91 98765-43210',
      department: '   ',
    });
    expect(parsed).toMatchObject({ email: null, phone: '+919876543210', department: null });
  });

  it.each([
    [{ employeeCode: 'a b' }],
    [{ fullName: '<b>x</b>' }],
    [{ joiningDate: '2026-13-40' }],
    [{ phone: 'call me' }],
    [{ email: 'not-an-email' }],
    [{ designation: 'x<script>' }],
    [{ role: 'owner' }],
  ])('rejects %j', (bad) => {
    expect(createEmployeeInputSchema.safeParse({ ...base, ...bad }).success).toBe(false);
  });
});

describe('shift, attendance and leave inputs', () => {
  it('requires half day to be shorter than full day', () => {
    const shift = {
      name: 'General',
      startTime: '09:00',
      endTime: '18:00',
      graceMinutes: 10,
      fullDayMinutes: 480,
      halfDayMinutes: 240,
    };
    expect(createShiftInputSchema.safeParse(shift).success).toBe(true);
    expect(createShiftInputSchema.safeParse({ ...shift, halfDayMinutes: 480 }).success).toBe(false);
    expect(createShiftInputSchema.safeParse({ ...shift, startTime: '9:00' }).success).toBe(false);
  });

  it('counts calendar days inclusively', () => {
    expect(daysInclusive('2026-11-10', '2026-11-10')).toBe(1);
    expect(daysInclusive('2026-11-10', '2026-11-12')).toBe(3);
    expect(daysInclusive('2026-12-30', '2027-01-02')).toBe(4);
  });

  it('limits the attendance range and leave length', () => {
    const range = { from: '2026-11-01', to: '2026-11-30' };
    expect(attendanceRangeInputSchema.safeParse(range).success).toBe(true);
    expect(
      attendanceRangeInputSchema.safeParse({ from: '2026-01-01', to: '2026-06-30' }).success,
    ).toBe(false);
    expect(
      attendanceRangeInputSchema.safeParse({ from: '2026-11-30', to: '2026-11-01' }).success,
    ).toBe(false);

    const leave = {
      leaveTypeId: BRANCH,
      startDate: '2026-11-10',
      endDate: '2026-11-11',
      reason: 'Family function',
    };
    expect(requestLeaveInputSchema.safeParse(leave).success).toBe(true);
    expect(requestLeaveInputSchema.safeParse({ ...leave, endDate: '2026-11-09' }).success).toBe(
      false,
    );
    expect(requestLeaveInputSchema.safeParse({ ...leave, endDate: '2027-02-01' }).success).toBe(
      false,
    );
  });
});

describe('manualPunchInputSchema', () => {
  const base = { employeeId: BRANCH, reason: 'Forgot to punch' };

  it('accepts an in, an out, or both in order', () => {
    expect(
      manualPunchInputSchema.safeParse({ ...base, inAt: '2026-11-10T09:00:00+05:30' }).success,
    ).toBe(true);
    expect(
      manualPunchInputSchema.safeParse({ ...base, outAt: '2026-11-10T18:00:00+05:30' }).success,
    ).toBe(true);
    expect(
      manualPunchInputSchema.safeParse({
        ...base,
        inAt: '2026-11-10T09:00:00+05:30',
        outAt: '2026-11-10T18:00:00+05:30',
      }).success,
    ).toBe(true);
  });

  it('rejects no time, out before in, a missing offset and a blank reason', () => {
    expect(manualPunchInputSchema.safeParse(base).success).toBe(false);
    expect(
      manualPunchInputSchema.safeParse({
        ...base,
        inAt: '2026-11-10T18:00:00+05:30',
        outAt: '2026-11-10T09:00:00+05:30',
      }).success,
    ).toBe(false);
    expect(manualPunchInputSchema.safeParse({ ...base, inAt: '2026-11-10T09:00:00' }).success).toBe(
      false,
    );
    expect(
      manualPunchInputSchema.safeParse({ ...base, inAt: '2026-11-10T09:00:00Z', reason: ' ' })
        .success,
    ).toBe(false);
  });
});

describe('work calendar inputs', () => {
  it('sorts and de-duplicates weekly off days, and keeps at least one working day', () => {
    expect(workCalendarInputSchema.parse({ weeklyOffDays: [6, 0, 6] }).weeklyOffDays).toEqual([
      0, 6,
    ]);
    expect(workCalendarInputSchema.parse({ weeklyOffDays: [] }).weeklyOffDays).toEqual([]);
    expect(
      workCalendarInputSchema.safeParse({ weeklyOffDays: [0, 1, 2, 3, 4, 5, 6] }).success,
    ).toBe(false);
    expect(workCalendarInputSchema.safeParse({ weeklyOffDays: [7] }).success).toBe(false);
    expect(workCalendarInputSchema.safeParse({ weeklyOffDays: [0], extra: 1 }).success).toBe(false);
  });

  it('validates holidays', () => {
    expect(
      createHolidayInputSchema.safeParse({ holidayDate: '2026-12-25', name: 'Christmas' }).success,
    ).toBe(true);
    expect(
      createHolidayInputSchema.safeParse({ holidayDate: '2026-02-30', name: 'Christmas' }).success,
    ).toBe(false);
    expect(
      createHolidayInputSchema.safeParse({ holidayDate: '2026-12-25', name: '<i>x</i>' }).success,
    ).toBe(false);
  });
});
