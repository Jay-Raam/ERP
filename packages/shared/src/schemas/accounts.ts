import { z } from 'zod';
import { parsePaise } from '../purchase-math';
import { dateSchema } from './hr';
import { pageFields, searchText, uuid } from './purchase';
import { optionalText, plainText } from './text';

// ------------------------------------------------------------------ accounts

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Assets and expenses grow with debits; the rest grow with credits. */
export const DEBIT_NORMAL: readonly AccountType[] = ['asset', 'expense'];

export const createAccountInputSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^[0-9]{3,8}$/, 'Use 3 to 8 digits, e.g. 5200'),
  name: plainText('Account name', 2, 80),
  type: z.enum(ACCOUNT_TYPES),
});

/** Code and type are fixed once entries can refer to the account. */
export const updateAccountInputSchema = z.strictObject({
  name: plainText('Account name', 2, 80),
  status: z.enum(['active', 'inactive']),
  version: z.number().int().min(1),
});

// --------------------------------------------------------------------- money

const MONEY = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/;
export const moneyAmountSchema = z
  .string()
  .trim()
  .regex(MONEY, 'Enter an amount like 1500 or 99.50');
export const positiveMoneySchema = moneyAmountSchema.refine(
  (v) => !MONEY.test(v) || parsePaise(v) > 0n,
  'Amount must be more than zero',
);

// -------------------------------------------------------------------- journal

export const createJournalEntryInputSchema = z
  .strictObject({
    entryDate: dateSchema,
    memo: plainText('Memo', 3, 200),
    branchId: uuid.nullish().transform((v) => v ?? null),
    lines: z
      .array(
        z.strictObject({
          accountId: uuid,
          debit: moneyAmountSchema.default('0'),
          credit: moneyAmountSchema.default('0'),
        }),
      )
      .min(2, 'An entry needs at least two lines')
      .max(50, 'At most 50 lines'),
  })
  .superRefine((entry, ctx) => {
    let debit = 0n;
    let credit = 0n;
    let usable = true;
    entry.lines.forEach((line, index) => {
      if (!MONEY.test(line.debit) || !MONEY.test(line.credit)) {
        usable = false;
        return;
      }
      const d = parsePaise(line.debit);
      const c = parsePaise(line.credit);
      if (d > 0n === c > 0n) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines', index, 'debit'],
          message: 'Each line must have either a debit or a credit',
        });
      }
      debit += d;
      credit += c;
    });
    if (usable && debit !== credit) {
      ctx.addIssue({
        code: 'custom',
        path: ['lines'],
        message: 'Debits and credits must be equal',
      });
    }
  });

export const reverseJournalInputSchema = z.strictObject({
  reason: plainText('Reason', 3, 200),
});

export const listJournalInputSchema = z.strictObject({
  from: dateSchema.nullish().transform((v) => v ?? undefined),
  to: dateSchema.nullish().transform((v) => v ?? undefined),
  accountId: uuid.nullish().transform((v) => v ?? undefined),
  search: searchText,
  ...pageFields,
});

export const trialBalanceInputSchema = z.strictObject({
  asOf: dateSchema.nullish().transform((v) => v ?? undefined),
});

export const accountLedgerInputSchema = z.strictObject({
  accountId: uuid,
  from: dateSchema.nullish().transform((v) => v ?? undefined),
  to: dateSchema.nullish().transform((v) => v ?? undefined),
  ...pageFields,
});

// ------------------------------------------------------------------- invoices

export const INVOICE_KINDS = ['sales', 'purchase'] as const;
export type InvoiceKind = (typeof INVOICE_KINDS)[number];
export const INVOICE_STATUSES = ['draft', 'posted', 'cancelled'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

function dueNotBefore(v: { invoiceDate: string; dueDate: string | null }, ctx: z.RefinementCtx) {
  if (v.dueDate && v.dueDate < v.invoiceDate) {
    ctx.addIssue({
      code: 'custom',
      path: ['dueDate'],
      message: 'Due date cannot be before the invoice date',
    });
  }
}

const invoiceEditable = {
  invoiceDate: dateSchema,
  dueDate: dateSchema.nullish().transform((v) => v ?? null),
  reference: optionalText('Reference', 40),
  notes: optionalText('Notes', 300),
};

/** A sales invoice is made from a delivery; a supplier bill from a goods receipt. */
export const createInvoiceInputSchema = z
  .strictObject({ kind: z.enum(INVOICE_KINDS), sourceId: uuid, ...invoiceEditable })
  .superRefine(dueNotBefore);

export const updateInvoiceInputSchema = z
  .strictObject({ ...invoiceEditable, version: z.number().int().min(1) })
  .superRefine(dueNotBefore);

/** The web form carries the editable fields only; an empty date input arrives as "". */
export const invoiceFormSchema = z
  .object({
    invoiceDate: dateSchema,
    dueDate: z
      .preprocess((v) => (v === '' ? null : v), dateSchema.nullish())
      .transform((v) => v ?? null),
    reference: optionalText('Reference', 40),
    notes: optionalText('Notes', 300),
  })
  .superRefine(dueNotBefore);

export const postInvoiceInputSchema = z.strictObject({ version: z.number().int().min(1) });

export const cancelInvoiceInputSchema = z.strictObject({
  version: z.number().int().min(1),
  reason: plainText('Reason', 3, 200),
});

export const listInvoicesInputSchema = z.strictObject({
  kind: z.enum(INVOICE_KINDS),
  search: searchText,
  status: z
    .enum(INVOICE_STATUSES)
    .nullish()
    .transform((v) => v ?? undefined),
  outstandingOnly: z
    .boolean()
    .nullish()
    .transform((v) => v ?? false),
  ...pageFields,
});

// ------------------------------------------------------------------- payments

export const PAYMENT_METHODS = ['cash', 'bank', 'upi', 'cheque', 'card'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const recordPaymentInputSchema = z.strictObject({
  invoiceId: uuid,
  amount: positiveMoneySchema,
  method: z.enum(PAYMENT_METHODS),
  paidOn: dateSchema,
  reference: optionalText('Reference', 40),
});

export const voidPaymentInputSchema = z.strictObject({
  reason: plainText('Reason', 3, 200),
});

export const listPaymentsInputSchema = z.strictObject({
  kind: z
    .enum(INVOICE_KINDS)
    .nullish()
    .transform((v) => v ?? undefined),
  invoiceId: uuid.nullish().transform((v) => v ?? undefined),
  ...pageFields,
});

export const ageingInputSchema = z.strictObject({ kind: z.enum(INVOICE_KINDS) });
