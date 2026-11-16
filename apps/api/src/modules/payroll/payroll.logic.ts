import { paiseToString, parsePaise } from '@erp/shared';
import type { DayStatus } from '../hr/attendance.logic';

/**
 * Pure payroll rules: no database, no clock. Money is BigInt paise; days are counted in
 * halves so that a half day is exact.
 */

/** How many half days of pay each attendance status earns. */
export const PAID_HALVES: Record<DayStatus, number> = {
  present: 2,
  half_day: 1,
  // A day with punches but under half a day, or an "in" never closed, earns nothing until fixed.
  short: 0,
  incomplete: 0,
  leave: 2,
  off: 2,
  holiday: 2,
  absent: 0,
  upcoming: 0,
};

export interface DayCounts {
  present: number;
  half: number;
  leave: number;
  off: number;
  holiday: number;
  absent: number;
  short: number;
  incomplete: number;
  /** Paid days times two. */
  paidHalves: number;
}

/** Counts a month's attendance. Days before the joining date are not in `days`, so they earn nothing. */
export function countDays(days: readonly { status: DayStatus }[]): DayCounts {
  const c: DayCounts = {
    present: 0,
    half: 0,
    leave: 0,
    off: 0,
    holiday: 0,
    absent: 0,
    short: 0,
    incomplete: 0,
    paidHalves: 0,
  };
  for (const d of days) {
    c.paidHalves += PAID_HALVES[d.status];
    switch (d.status) {
      case 'present':
        c.present++;
        break;
      case 'half_day':
        c.half++;
        break;
      case 'leave':
        c.leave++;
        break;
      case 'off':
        c.off++;
        break;
      case 'holiday':
        c.holiday++;
        break;
      case 'short':
        c.short++;
        break;
      case 'incomplete':
        c.incomplete++;
        break;
      case 'absent':
        c.absent++;
        break;
      case 'upcoming':
        break;
    }
  }
  return c;
}

/** Monthly amount times paid days over days in the month, rounded half up to the paisa. */
export function prorate(fullPaise: bigint, paidHalves: number, daysInPeriod: number): bigint {
  const numerator = fullPaise * BigInt(paidHalves);
  const denominator = BigInt(daysInPeriod) * 2n;
  return (numerator * 2n + denominator) / (denominator * 2n);
}

export interface PayInput {
  basic: string;
  hra: string;
  allowance: string;
  deductions: string;
  bonus: string;
  otherDeductions: string;
  paidHalves: number;
  daysInPeriod: number;
}

export interface PayResult {
  fullGross: string;
  earned: string;
  bonus: string;
  deductions: string;
  otherDeductions: string;
  /** True when deductions were cut down so that net pay is not negative. */
  capped: boolean;
  net: string;
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);

/**
 * Net pay for one employee. Deductions never take net pay below zero: the fixed deduction is
 * applied first, then the one-off deduction, each limited to what is left.
 */
export function computePay(i: PayInput): PayResult {
  const fullGross = parsePaise(i.basic) + parsePaise(i.hra) + parsePaise(i.allowance);
  const earned = prorate(fullGross, i.paidHalves, i.daysInPeriod);
  const bonus = parsePaise(i.bonus);
  const available = earned + bonus;
  const wantedFixed = parsePaise(i.deductions);
  const wantedOther = parsePaise(i.otherDeductions);
  const fixed = min(wantedFixed, available);
  const other = min(wantedOther, available - fixed);
  return {
    fullGross: paiseToString(fullGross),
    earned: paiseToString(earned),
    bonus: paiseToString(bonus),
    deductions: paiseToString(fixed),
    otherDeductions: paiseToString(other),
    capped: fixed < wantedFixed || other < wantedOther,
    net: paiseToString(available - fixed - other),
  };
}

/** "2026-10" -> first day, last day, number of days. */
export function monthBounds(month: string): { start: string; end: string; days: number } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  return { start: `${y}-${pad(m)}-01`, end: `${y}-${pad(m)}-${pad(days)}`, days };
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "2026-10-01" -> "October 2026". */
export function monthLabel(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
}
