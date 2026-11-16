import {
  createJournalEntryInputSchema,
  invoiceFormSchema,
  recordPaymentInputSchema,
} from '@erp/shared';
import { describe, expect, it } from 'vitest';
import { isOverdue, localToday } from './format';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('localToday', () => {
  it('uses the local calendar day, not the UTC one', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localToday(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31');
  });
});

describe('isOverdue', () => {
  const base = { status: 'posted' as const, dueDate: '2026-03-10', outstanding: '100.00' };
  it('flags a posted invoice with a balance after its due date', () => {
    expect(isOverdue(base, '2026-03-11')).toBe(true);
  });
  it('is not overdue on the due date, once paid, or when not posted', () => {
    expect(isOverdue(base, '2026-03-10')).toBe(false);
    expect(isOverdue({ ...base, outstanding: '0.00' }, '2026-04-01')).toBe(false);
    expect(isOverdue({ ...base, status: 'draft' }, '2026-04-01')).toBe(false);
    expect(isOverdue({ ...base, status: 'cancelled' }, '2026-04-01')).toBe(false);
  });
});

describe('invoiceFormSchema', () => {
  it('turns empty optional fields into null', () => {
    const r = invoiceFormSchema.parse({
      invoiceDate: '2026-03-01',
      dueDate: '',
      reference: '',
      notes: '',
    });
    expect(r.dueDate).toBeNull();
  });
  it('rejects a due date before the invoice date', () => {
    const r = invoiceFormSchema.safeParse({
      invoiceDate: '2026-03-10',
      dueDate: '2026-03-01',
      reference: '',
      notes: '',
    });
    expect(r.success).toBe(false);
  });
  it('rejects markup in notes', () => {
    const r = invoiceFormSchema.safeParse({
      invoiceDate: '2026-03-10',
      dueDate: '',
      reference: '',
      notes: '<script>alert(1)</script>',
    });
    expect(r.success).toBe(false);
  });
});

describe('recordPaymentInputSchema', () => {
  const ok = {
    invoiceId: uuid(1),
    amount: '500.50',
    method: 'upi',
    paidOn: '2026-03-10',
    reference: '',
  };
  it('accepts a normal payment', () => {
    expect(recordPaymentInputSchema.safeParse(ok).success).toBe(true);
  });
  it('rejects zero, negative, three-decimal and non-numeric amounts', () => {
    for (const amount of ['0', '0.00', '-5', '1.234', 'abc', '1e3', '']) {
      expect(recordPaymentInputSchema.safeParse({ ...ok, amount }).success, amount).toBe(false);
    }
  });
  it('rejects an unknown method and stray keys', () => {
    expect(recordPaymentInputSchema.safeParse({ ...ok, method: 'crypto' }).success).toBe(false);
    expect(recordPaymentInputSchema.safeParse({ ...ok, paidAmount: '1' }).success).toBe(false);
  });
});

describe('createJournalEntryInputSchema', () => {
  const entry = (lines: { debit?: string; credit?: string }[]) => ({
    entryDate: '2026-03-10',
    memo: 'Owner capital',
    branchId: null,
    lines: lines.map((l, i) => ({ accountId: uuid(i + 1), debit: '0', credit: '0', ...l })),
  });
  it('accepts a balanced entry', () => {
    expect(
      createJournalEntryInputSchema.safeParse(entry([{ debit: '100.10' }, { credit: '100.10' }]))
        .success,
    ).toBe(true);
  });
  it('rejects an unbalanced entry', () => {
    expect(
      createJournalEntryInputSchema.safeParse(entry([{ debit: '100' }, { credit: '99.99' }]))
        .success,
    ).toBe(false);
  });
  it('rejects a line with both or neither side', () => {
    expect(
      createJournalEntryInputSchema.safeParse(entry([{ debit: '5', credit: '5' }, { credit: '0' }]))
        .success,
    ).toBe(false);
  });
  it('never throws on garbage amounts', () => {
    expect(() =>
      createJournalEntryInputSchema.safeParse(entry([{ debit: 'x' }, { credit: '9'.repeat(40) }])),
    ).not.toThrow();
  });
  it('needs at least two lines', () => {
    expect(createJournalEntryInputSchema.safeParse(entry([{ debit: '1' }])).success).toBe(false);
  });
});
