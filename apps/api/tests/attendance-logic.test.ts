import { describe, expect, it } from 'vitest';
import {
  buildDays,
  eachDate,
  localDate,
  localMinutes,
  nextPunchKind,
  summariseDay,
  type ShiftRules,
} from '../src/modules/hr/attendance.logic';
import { computeBalance } from '../src/modules/hr/leave.service';

const IST = 'Asia/Kolkata';
const shift: ShiftRules = {
  startTime: '09:00:00',
  graceMinutes: 15,
  fullDayMinutes: 480,
  halfDayMinutes: 240,
};
const t = (iso: string) => new Date(iso);

describe('time zones', () => {
  it('puts an instant on the local calendar day, not the UTC one', () => {
    // 20:00 UTC on the 10th is 01:30 IST on the 11th.
    expect(localDate(t('2026-11-10T20:00:00Z'), IST)).toBe('2026-11-11');
    expect(localDate(t('2026-11-10T20:00:00Z'), 'UTC')).toBe('2026-11-10');
    expect(localMinutes(t('2026-11-11T04:00:00Z'), IST)).toBe(9 * 60 + 30);
  });

  it('handles daylight saving where the zone has it', () => {
    // New York is UTC-5 in winter and UTC-4 in summer: 09:00 local both times.
    expect(localMinutes(t('2026-01-15T14:00:00Z'), 'America/New_York')).toBe(540);
    expect(localMinutes(t('2026-07-15T13:00:00Z'), 'America/New_York')).toBe(540);
  });
});

describe('nextPunchKind', () => {
  it('starts with in and alternates', () => {
    expect(nextPunchKind(null)).toBe('in');
    expect(nextPunchKind({ kind: 'in', at: new Date() })).toBe('out');
    expect(nextPunchKind({ kind: 'out', at: new Date() })).toBe('in');
  });
});

describe('summariseDay', () => {
  const day = (...p: [string, 'in' | 'out'][]) =>
    summariseDay(
      '2026-11-11',
      p.map(([at, kind]) => ({ at: t(at), kind })),
      shift,
      IST,
    );

  it('marks a full day, a half day and a short day by worked minutes', () => {
    expect(day(['2026-11-11T03:30:00Z', 'in'], ['2026-11-11T12:30:00Z', 'out']).status).toBe(
      'present',
    ); // 9h
    expect(day(['2026-11-11T03:30:00Z', 'in'], ['2026-11-11T07:30:00Z', 'out']).status).toBe(
      'half_day',
    ); // 4h
    expect(day(['2026-11-11T03:30:00Z', 'in'], ['2026-11-11T05:00:00Z', 'out']).status).toBe(
      'short',
    ); // 1.5h
  });

  it('adds up several sessions and ignores the lunch gap', () => {
    const d = day(
      ['2026-11-11T03:30:00Z', 'in'],
      ['2026-11-11T07:30:00Z', 'out'],
      ['2026-11-11T08:30:00Z', 'in'],
      ['2026-11-11T12:30:00Z', 'out'],
    );
    expect(d.workedMinutes).toBe(480);
    expect(d.status).toBe('present');
  });

  it('is incomplete while an in is still open, and counts it as not worked yet', () => {
    const d = day(['2026-11-11T03:30:00Z', 'in']);
    expect(d).toMatchObject({ status: 'incomplete', open: true, workedMinutes: 0 });
  });

  it('judges lateness against the shift start plus grace, in local time', () => {
    expect(day(['2026-11-11T03:45:00Z', 'in'], ['2026-11-11T12:00:00Z', 'out']).late).toBe(false); // 09:15
    expect(day(['2026-11-11T03:46:00Z', 'in'], ['2026-11-11T12:00:00Z', 'out']).late).toBe(true); // 09:16
  });

  it('never reports lateness without a shift', () => {
    const d = summariseDay(
      '2026-11-11',
      [{ at: t('2026-11-11T09:00:00Z'), kind: 'in' }],
      null,
      IST,
    );
    expect(d.late).toBe(false);
  });
});

describe('buildDays', () => {
  const base = {
    today: '2026-11-11',
    joiningDate: '2026-11-03',
    shift,
    timeZone: IST,
    punches: [],
  };

  it('lists each date, skipping days before joining and marking the rest', () => {
    const days = buildDays({
      ...base,
      from: '2026-11-01',
      to: '2026-11-13',
      leave: [{ startDate: '2026-11-05', endDate: '2026-11-06' }],
    });
    const byDate = Object.fromEntries(days.map((d) => [d.date, d.status]));
    expect(byDate['2026-11-02']).toBeUndefined();
    expect(byDate['2026-11-03']).toBe('absent');
    expect(byDate['2026-11-05']).toBe('leave');
    expect(byDate['2026-11-06']).toBe('leave');
    expect(byDate['2026-11-11']).toBe('absent');
    expect(byDate['2026-11-12']).toBe('upcoming');
  });

  it('prefers punches over leave when someone worked on a leave day', () => {
    const days = buildDays({
      ...base,
      from: '2026-11-05',
      to: '2026-11-05',
      leave: [{ startDate: '2026-11-05', endDate: '2026-11-05' }],
      punches: [
        { at: t('2026-11-05T03:30:00Z'), kind: 'in' },
        { at: t('2026-11-05T12:30:00Z'), kind: 'out' },
      ],
    });
    expect(days[0]!.status).toBe('present');
  });

  it('lists dates across month and year ends', () => {
    expect(eachDate('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });
});

describe('weekly off', () => {
  const base = {
    today: '2026-11-20',
    joiningDate: '2026-01-01',
    shift,
    timeZone: IST,
    punches: [],
    leave: [],
  };

  it('marks the configured weekdays as off instead of absent', () => {
    // 2026-11-14 is a Saturday, 11-15 a Sunday, 11-16 a Monday.
    const days = buildDays({ ...base, from: '2026-11-14', to: '2026-11-16', weeklyOff: [0] });
    expect(days.map((d) => d.status)).toEqual(['absent', 'off', 'absent']);
    const two = buildDays({ ...base, from: '2026-11-14', to: '2026-11-16', weeklyOff: [0, 6] });
    expect(two.map((d) => d.status)).toEqual(['off', 'off', 'absent']);
  });

  it('still shows the day worked when someone punched on a day off', () => {
    const days = buildDays({
      ...base,
      from: '2026-11-15',
      to: '2026-11-15',
      weeklyOff: [0],
      punches: [
        { at: t('2026-11-15T03:30:00Z'), kind: 'in' },
        { at: t('2026-11-15T12:30:00Z'), kind: 'out' },
      ],
    });
    expect(days[0]!.status).toBe('present');
  });

  it('keeps upcoming days off too, and defaults to no days off', () => {
    expect(
      buildDays({ ...base, from: '2026-11-22', to: '2026-11-22', weeklyOff: [0] })[0]!.status,
    ).toBe('off');
    expect(buildDays({ ...base, from: '2026-11-15', to: '2026-11-15' })[0]!.status).toBe('absent');
  });
});

describe('computeBalance', () => {
  const type = {
    id: 't1',
    code: 'CL',
    name: 'Casual',
    annualDays: 12,
    paid: true,
    status: 'active' as const,
    version: 1,
  };

  it('subtracts approved and pending, and never goes below zero', () => {
    const usage = [
      { leaveTypeId: 't1', status: 'approved', days: 5 },
      { leaveTypeId: 't1', status: 'pending', days: 2.5 },
      { leaveTypeId: 'other', status: 'approved', days: 9 },
    ];
    expect(computeBalance(type, usage)).toMatchObject({ used: 5, pending: 2.5, remaining: 4.5 });
    expect(
      computeBalance(type, [{ leaveTypeId: 't1', status: 'approved', days: 20 }]).remaining,
    ).toBe(0);
  });
});

describe('holidays', () => {
  const base = {
    today: '2026-11-20',
    joiningDate: '2026-01-01',
    shift,
    timeZone: IST,
    punches: [],
    leave: [],
    weeklyOff: [0],
  };
  const holidays = new Map([
    ['2026-11-15', 'Diwali'], // a Sunday: the holiday name wins over the plain "off"
    ['2026-11-17', 'Founders day'],
  ]);

  it('marks a holiday with no punches as a holiday, ahead of off and leave', () => {
    const days = buildDays({
      ...base,
      from: '2026-11-15',
      to: '2026-11-18',
      holidays,
      leave: [{ startDate: '2026-11-17', endDate: '2026-11-18' }],
    });
    expect(days.map((d) => d.status)).toEqual(['holiday', 'absent', 'holiday', 'leave']);
    expect(days[0]!.holidayName).toBe('Diwali');
    expect(days[1]!.holidayName).toBeNull();
  });

  it('shows the work done when someone punches on a holiday', () => {
    const days = buildDays({
      ...base,
      from: '2026-11-17',
      to: '2026-11-17',
      holidays,
      punches: [
        { kind: 'in', at: new Date('2026-11-17T04:00:00Z') },
        { kind: 'out', at: new Date('2026-11-17T12:00:00Z') },
      ],
    });
    expect(days[0]!.status).toBe('present');
  });

  it('is unchanged when there are no holidays', () => {
    const days = buildDays({ ...base, from: '2026-11-16', to: '2026-11-17' });
    expect(days.map((d) => d.status)).toEqual(['absent', 'absent']);
  });
});
