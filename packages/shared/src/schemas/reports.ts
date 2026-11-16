import { z } from 'zod';
import { dateSchema, daysInclusive } from './hr';
import { monthSchema } from './payroll';
import { pageFields, searchText, uuid } from './purchase';

/** The longest period a report covers, so one request cannot sweep ten years of ledger. */
export const MAX_REPORT_DAYS = 3660;

const optionalDate = dateSchema.nullish().transform((v) => v ?? undefined);

/** When both ends are given the range must run forwards and stay within the limit. */
function checkRange(v: { from?: string; to?: string }, ctx: z.RefinementCtx) {
  if (!v.from || !v.to) return;
  if (v.from > v.to) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'The end date is before the start' });
  } else if (daysInclusive(v.from, v.to) > MAX_REPORT_DAYS) {
    ctx.addIssue({ code: 'custom', path: ['to'], message: 'Choose a period of ten years or less' });
  }
}

export const profitAndLossInputSchema = z
  .strictObject({ from: optionalDate, to: optionalDate })
  .superRefine(checkRange);

export const balanceSheetInputSchema = z.strictObject({ asOf: optionalDate });

export const REPORT_KINDS = ['sales', 'purchase'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const invoiceSummaryInputSchema = z
  .strictObject({
    kind: z.enum(REPORT_KINDS),
    from: optionalDate,
    to: optionalDate,
    branchId: uuid.nullish().transform((v) => v ?? undefined),
  })
  .superRefine(checkRange);

export const stockReportInputSchema = z.strictObject({
  search: searchText,
  lowOnly: z
    .boolean()
    .nullish()
    .transform((v) => v ?? false),
  ...pageFields,
});

export const attendanceSummaryInputSchema = z.strictObject({
  month: monthSchema.nullish().transform((v) => v ?? undefined),
  branchId: uuid.nullish().transform((v) => v ?? undefined),
  search: searchText,
  ...pageFields,
});

export const payrollSummaryInputSchema = z
  .strictObject({
    fromMonth: monthSchema.nullish().transform((v) => v ?? undefined),
    toMonth: monthSchema.nullish().transform((v) => v ?? undefined),
  })
  .superRefine((v, ctx) => {
    if (v.fromMonth && v.toMonth && v.fromMonth > v.toMonth) {
      ctx.addIssue({
        code: 'custom',
        path: ['toMonth'],
        message: 'The last month is before the first',
      });
    }
  });

/** The financial year an Indian business reports on: 1 April to 31 March. */
export function financialYearStart(today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return `${month >= 4 ? year : year - 1}-04-01`;
}
