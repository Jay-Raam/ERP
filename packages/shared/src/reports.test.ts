import { describe, expect, it } from 'vitest';
import {
  attendanceSummaryInputSchema,
  financialYearStart,
  invoiceSummaryInputSchema,
  payrollSummaryInputSchema,
  profitAndLossInputSchema,
  stockReportInputSchema,
} from './index';

describe('financialYearStart', () => {
  it('starts on 1 April', () => {
    expect(financialYearStart('2026-11-13')).toBe('2026-04-01');
    expect(financialYearStart('2026-04-01')).toBe('2026-04-01');
    expect(financialYearStart('2027-03-31')).toBe('2026-04-01');
    expect(financialYearStart('2027-01-05')).toBe('2026-04-01');
  });
});

describe('report inputs', () => {
  it('accepts no dates at all, so the server picks the period', () => {
    expect(profitAndLossInputSchema.parse({})).toEqual({ from: undefined, to: undefined });
    expect(profitAndLossInputSchema.parse({ from: null, to: null })).toEqual({
      from: undefined,
      to: undefined,
    });
  });

  it('refuses a backwards or oversized range', () => {
    expect(
      profitAndLossInputSchema.safeParse({ from: '2026-05-01', to: '2026-04-30' }).success,
    ).toBe(false);
    expect(
      profitAndLossInputSchema.safeParse({ from: '2000-01-01', to: '2026-01-01' }).success,
    ).toBe(false);
    expect(
      profitAndLossInputSchema.safeParse({ from: '2026-04-01', to: '2026-04-01' }).success,
    ).toBe(true);
  });

  it('refuses impossible dates and stray fields', () => {
    expect(profitAndLossInputSchema.safeParse({ from: '2026-02-30' }).success).toBe(false);
    expect(profitAndLossInputSchema.safeParse({ tenantId: 'x' }).success).toBe(false);
  });

  it('needs a kind for the invoice summary', () => {
    expect(invoiceSummaryInputSchema.safeParse({}).success).toBe(false);
    expect(invoiceSummaryInputSchema.safeParse({ kind: 'refunds' }).success).toBe(false);
    expect(invoiceSummaryInputSchema.safeParse({ kind: 'sales' }).success).toBe(true);
  });

  it('pages stock and attendance with sensible defaults', () => {
    expect(stockReportInputSchema.parse({})).toMatchObject({
      lowOnly: false,
      limit: 25,
      offset: 0,
    });
    expect(attendanceSummaryInputSchema.safeParse({ month: '2026-13' }).success).toBe(false);
    expect(attendanceSummaryInputSchema.safeParse({ month: '2026-10', limit: 500 }).success).toBe(
      false,
    );
  });

  it('keeps payroll months in order', () => {
    expect(
      payrollSummaryInputSchema.safeParse({ fromMonth: '2026-10', toMonth: '2026-09' }).success,
    ).toBe(false);
    expect(
      payrollSummaryInputSchema.safeParse({ fromMonth: '2026-04', toMonth: '2026-10' }).success,
    ).toBe(true);
  });
});
