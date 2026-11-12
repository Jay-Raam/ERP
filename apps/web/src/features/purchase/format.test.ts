import { describe, expect, it } from 'vitest';
import { orderFormSchema, receiveGoodsInputSchema } from '@erp/shared';
import { formatMoney, previewLine, previewOrder, remainingQty } from './format';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('formatMoney', () => {
  it('uses Indian grouping and two decimals', () => {
    expect(formatMoney('1234567.5')).toBe('₹12,34,567.50');
    expect(formatMoney('0.00')).toBe('₹0.00');
    expect(formatMoney('999')).toBe('₹999.00');
  });
  it('leaves odd input alone', () => {
    expect(formatMoney('abc')).toBe('abc');
  });
});

describe('previewLine / previewOrder', () => {
  it('matches the server maths', () => {
    expect(previewLine({ quantity: '3', unitPrice: '99.50', gstRate: 18 })?.total).toBe(35223n);
    const p = previewOrder([
      { quantity: '3', unitPrice: '99.50', gstRate: 18 },
      { quantity: '1.5', unitPrice: '10', gstRate: 5 },
    ]);
    expect(p.complete).toBe(true);
    expect(p.total).toBe('367.98');
  });
  it('returns null for incomplete or invalid input and never throws', () => {
    expect(previewLine({ quantity: '', unitPrice: '5', gstRate: 18 })).toBeNull();
    expect(previewLine({ quantity: '1', unitPrice: '1e9', gstRate: 18 })).toBeNull();
    expect(previewLine({ quantity: '1', unitPrice: '5', gstRate: 99 })).toBeNull();
    const p = previewOrder([{ quantity: 'x', unitPrice: '5', gstRate: 18 }]);
    expect(p.complete).toBe(false);
    expect(p.total).toBe('0.00');
  });
});

describe('remainingQty', () => {
  it('subtracts exactly and never goes negative', () => {
    expect(remainingQty('10.000', '2.500')).toBe('7.500');
    expect(remainingQty('1', '1')).toBe('0.000');
    expect(remainingQty('1', '3')).toBe('0.000');
  });
});

describe('order form schema', () => {
  const base = {
    supplierId: uuid(1),
    orderDate: '2026-11-01',
    expectedDate: '',
    notes: '',
    lines: [{ itemId: uuid(2), quantity: '2', unitPrice: '10', gstRate: 18 }],
  };
  it('accepts a good order without a branch', () => {
    expect(orderFormSchema.safeParse(base).success).toBe(true);
  });
  it('rejects duplicate items, bad GST and a past expected date', () => {
    const dup = { ...base, lines: [base.lines[0]!, base.lines[0]!] };
    expect(orderFormSchema.safeParse(dup).success).toBe(false);
    expect(
      orderFormSchema.safeParse({ ...base, lines: [{ ...base.lines[0]!, gstRate: 7 }] }).success,
    ).toBe(false);
    expect(orderFormSchema.safeParse({ ...base, expectedDate: '2026-10-01' }).success).toBe(false);
  });
});

describe('receive schema', () => {
  it('needs at least one line', () => {
    const r = receiveGoodsInputSchema.safeParse({
      orderId: uuid(1),
      warehouseId: uuid(2),
      lines: [],
    });
    expect(r.success).toBe(false);
  });
});
