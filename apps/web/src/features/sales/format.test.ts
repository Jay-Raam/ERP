import { salesOrderFormSchema } from '@erp/shared';
import { describe, expect, it } from 'vitest';
import { remainingQty, STATUS_LABEL } from './format';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('sales status labels', () => {
  it('covers every status', () => {
    expect(Object.keys(STATUS_LABEL).sort()).toEqual(
      ['cancelled', 'confirmed', 'delivered', 'draft', 'partly_delivered'].sort(),
    );
  });
});

describe('remainingQty (delivery)', () => {
  it('shows what is left to deliver', () => {
    expect(remainingQty('10.000', '4.250')).toBe('5.750');
    expect(remainingQty('1.000', '1.000')).toBe('0.000');
  });
});

describe('salesOrderFormSchema', () => {
  const ok = {
    customerId: uuid(1),
    orderDate: '2026-03-01',
    expectedDate: '',
    notes: '',
    lines: [{ itemId: uuid(2), quantity: '2', unitPrice: '150.00', gstRate: 18 }],
  };
  it('accepts a valid order and nulls the empty date', () => {
    const r = salesOrderFormSchema.safeParse(ok);
    expect(r.success).toBe(true);
  });
  it('rejects an empty order, a bad GST rate and a negative price', () => {
    expect(salesOrderFormSchema.safeParse({ ...ok, lines: [] }).success).toBe(false);
    expect(
      salesOrderFormSchema.safeParse({ ...ok, lines: [{ ...ok.lines[0]!, gstRate: 7 }] }).success,
    ).toBe(false);
    expect(
      salesOrderFormSchema.safeParse({ ...ok, lines: [{ ...ok.lines[0]!, unitPrice: '-1' }] })
        .success,
    ).toBe(false);
  });
});
