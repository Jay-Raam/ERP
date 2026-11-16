import { describe, expect, it } from 'vitest';
import {
  computePay,
  countDays,
  monthBounds,
  monthLabel,
  prorate,
} from '../src/modules/payroll/payroll.logic';

const pay = (over: Partial<Parameters<typeof computePay>[0]> = {}) =>
  computePay({
    basic: '30000',
    hra: '10000',
    allowance: '0',
    deductions: '0',
    bonus: '0',
    otherDeductions: '0',
    paidHalves: 62,
    daysInPeriod: 31,
    ...over,
  });

describe('prorate', () => {
  it('pays the whole month for every day paid', () => {
    expect(prorate(4_000_000n, 62, 31)).toBe(4_000_000n);
  });

  it('pays nothing for no paid days', () => {
    expect(prorate(4_000_000n, 0, 31)).toBe(0n);
  });

  it('rounds half up to the paisa', () => {
    // 40000.00 x 20 / 62 = 12903.2258...
    expect(prorate(4_000_000n, 20, 31)).toBe(1_290_323n);
    // 100.00 x (1 half day of 2 days = a quarter) = 25.00 exactly, and 0.05 x half = 0.025 rounds up
    expect(prorate(10_000n, 1, 2)).toBe(2_500n);
    expect(prorate(5n, 1, 1)).toBe(3n);
  });

  it('counts a half day as half a day', () => {
    // 30 days: 59 half days is 29.5 days
    expect(prorate(3_000_000n, 59, 30)).toBe(2_950_000n);
  });

  it('stays exact for the biggest salary', () => {
    const max = 9_999_999_999n;
    expect(prorate(max, 62, 31)).toBe(max);
    expect(prorate(max, 31, 31)).toBe((max + 1n) / 2n);
  });
});

describe('computePay', () => {
  it('adds bonus and takes both deductions', () => {
    const r = pay({ deductions: '500', bonus: '1000', otherDeductions: '250.50' });
    expect(r).toMatchObject({
      fullGross: '40000.00',
      earned: '40000.00',
      bonus: '1000.00',
      deductions: '500.00',
      otherDeductions: '250.50',
      capped: false,
      net: '40249.50',
    });
  });

  it('never lets net pay go below zero', () => {
    const r = pay({ paidHalves: 0, deductions: '500' });
    expect(r).toMatchObject({ earned: '0.00', deductions: '0.00', capped: true, net: '0.00' });
  });

  it('takes the fixed deduction before the one-off one', () => {
    const r = pay({ basic: '1000', hra: '0', deductions: '800', otherDeductions: '500' });
    expect(r).toMatchObject({
      deductions: '800.00',
      otherDeductions: '200.00',
      capped: true,
      net: '0.00',
    });
  });

  it('is not capped when the deductions fit exactly', () => {
    const r = pay({ basic: '1000', hra: '0', deductions: '1000' });
    expect(r).toMatchObject({ capped: false, net: '0.00' });
  });
});

describe('countDays', () => {
  it('counts each kind and the paid half days', () => {
    const c = countDays(
      (
        [
          'present',
          'present',
          'half_day',
          'short',
          'incomplete',
          'leave',
          'off',
          'holiday',
          'absent',
          'upcoming',
        ] as const
      ).map((status) => ({ status })),
    );
    expect(c).toEqual({
      present: 2,
      half: 1,
      leave: 1,
      off: 1,
      holiday: 1,
      absent: 1,
      short: 1,
      incomplete: 1,
      // 2 present (4) + half (1) + leave (2) + off (2) + holiday (2)
      paidHalves: 11,
    });
  });
});

describe('months', () => {
  it('gives the first and last day and the length', () => {
    expect(monthBounds('2026-10')).toEqual({ start: '2026-10-01', end: '2026-10-31', days: 31 });
    expect(monthBounds('2026-11')).toEqual({ start: '2026-11-01', end: '2026-11-30', days: 30 });
    expect(monthBounds('2024-02')).toEqual({ start: '2024-02-01', end: '2024-02-29', days: 29 });
    expect(monthBounds('2026-02').days).toBe(28);
  });

  it('labels a month', () => {
    expect(monthLabel('2026-10-01')).toBe('October 2026');
    expect(monthLabel('2026-01-31')).toBe('January 2026');
  });
});
