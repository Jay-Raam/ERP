import { z } from 'zod';
import { PAYMENT_METHODS } from './accounts';
import { dateSchema } from './hr';
import { pageFields, searchText, uuid } from './purchase';
import { optionalText, plainText } from './text';

/** A monthly amount in rupees: up to 99,999,999.99, two decimals at most. */
const SALARY = /^(0|[1-9][0-9]{0,7})(\.[0-9]{1,2})?$/;
export const salaryAmountSchema = z
  .string()
  .trim()
  .regex(SALARY, 'Enter an amount like 25000 or 1250.50');

const positiveSalary = salaryAmountSchema.refine(
  (v) => !SALARY.test(v) || Number(v) > 0,
  'Amount must be more than zero',
);

/** "2026-10": the month being paid. */
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-10');

const version = z.number().int().min(1);

// ------------------------------------------------------------ salary structure

export const saveSalaryStructureInputSchema = z
  .strictObject({
    employeeId: uuid,
    basic: positiveSalary,
    hra: salaryAmountSchema.default('0'),
    allowance: salaryAmountSchema.default('0'),
    deductions: salaryAmountSchema.default('0'),
    /** Present when changing an existing structure; empty when setting it for the first time. */
    version: version.nullish().transform((v) => v ?? null),
  })
  .superRefine((v, ctx) => {
    if (![v.basic, v.hra, v.allowance].every((x) => SALARY.test(x))) return;
    const paise = (x: string) => {
      const [whole, frac = ''] = x.split('.');
      return BigInt(whole!) * 100n + BigInt(frac.padEnd(2, '0'));
    };
    if (paise(v.basic) + paise(v.hra) + paise(v.allowance) > 9_999_999_999n) {
      ctx.addIssue({ code: 'custom', path: ['basic'], message: 'The monthly gross is too large' });
    }
  });

export const listSalaryStructuresInputSchema = z.strictObject({
  search: searchText,
  branchId: uuid.nullish().transform((v) => v ?? undefined),
  /** Only employees with no structure yet. */
  missingOnly: z
    .boolean()
    .nullish()
    .transform((v) => v ?? false),
  ...pageFields,
});

// ----------------------------------------------------------------- payroll runs

export const PAYROLL_STATUSES = ['draft', 'approved', 'paid', 'cancelled'] as const;
export type PayrollStatus = (typeof PAYROLL_STATUSES)[number];

export const createPayrollRunInputSchema = z.strictObject({
  month: monthSchema,
  notes: optionalText('Notes', 200),
});

export const recalculatePayrollRunInputSchema = z.strictObject({ version });

export const adjustPayslipInputSchema = z.strictObject({
  version,
  bonus: salaryAmountSchema.default('0'),
  otherDeductions: salaryAmountSchema.default('0'),
  note: optionalText('Note', 120),
});

export const approvePayrollRunInputSchema = z.strictObject({ version });

export const payPayrollRunInputSchema = z.strictObject({
  version,
  method: z.enum(PAYMENT_METHODS),
  paidOn: dateSchema,
  reference: optionalText('Reference', 40),
});

export const cancelPayrollRunInputSchema = z.strictObject({
  version,
  reason: plainText('Reason', 3, 200),
});

export const listPayrollRunsInputSchema = z.strictObject({
  status: z
    .enum(PAYROLL_STATUSES)
    .nullish()
    .transform((v) => v ?? undefined),
  ...pageFields,
});

export const listPayslipsInputSchema = z.strictObject({
  runId: uuid,
  search: searchText,
  ...pageFields,
});

export const myPayslipsInputSchema = z.strictObject({ ...pageFields });

/** Whole days, for the web form: an empty field arrives as "". */
export const payslipAdjustFormSchema = z.object({
  bonus: salaryAmountSchema,
  otherDeductions: salaryAmountSchema,
  note: optionalText('Note', 120),
});

export const salaryFormSchema = z.object({
  basic: positiveSalary,
  hra: salaryAmountSchema,
  allowance: salaryAmountSchema,
  deductions: salaryAmountSchema,
});

export const payRunFormSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  paidOn: dateSchema,
  reference: optionalText('Reference', 40),
});
