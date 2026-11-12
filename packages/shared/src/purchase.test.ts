import { describe, expect, it } from 'vitest';
import {
  createOrderInputSchema,
  createSupplierInputSchema,
  lineAmounts,
  orderAmounts,
  paiseToString,
  receiveGoodsInputSchema,
} from './index';

const id = '00000000-0000-4000-8000-000000000001';
const id2 = '00000000-0000-4000-8000-000000000002';

describe('purchase money maths', () => {
  it('rounds each line half-up to the paisa', () => {
    expect(lineAmounts('3', '100.50', 18)).toEqual({ subtotal: 30150n, tax: 5427n, total: 35577n });
    // 0.333 x 10.01 = 3.33333 -> 3.33; 5% of 3.33 = 0.1665 -> 0.17
    expect(lineAmounts('0.333', '10.01', 5)).toEqual({ subtotal: 333n, tax: 17n, total: 350n });
    // Exactly half a paisa rounds up: 0.005 x 1.00 = 0.005 -> 0.01
    expect(lineAmounts('0.005', '1', 0).subtotal).toBe(1n);
    expect(lineAmounts('0.004', '1', 0).subtotal).toBe(0n);
  });

  it('has no floating point drift', () => {
    // 0.1 + 0.2 style: ten lines of 0.1 x 0.3 must add up exactly.
    const lines = Array.from({ length: 10 }, () => lineAmounts('0.1', '0.30', 0));
    expect(orderAmounts(lines).total).toBe('0.30');
    expect(lineAmounts('1.1', '1.10', 0).subtotal).toBe(121n);
  });

  it('handles the largest allowed values', () => {
    expect(lineAmounts('99999999999.999', '999999999999.99', 28).total > 0n).toBe(true);
  });

  it('formats paise', () => {
    expect(paiseToString(0n)).toBe('0.00');
    expect(paiseToString(5n)).toBe('0.05');
    expect(paiseToString(123456n)).toBe('1234.56');
    expect(paiseToString(-5n)).toBe('-0.05');
  });

  it('sums an order from its rounded lines', () => {
    const lines = [lineAmounts('3', '100.50', 18), lineAmounts('0.333', '10.01', 5)];
    expect(orderAmounts(lines)).toEqual({ subtotal: '304.83', tax: '54.44', total: '359.27' });
  });
});

describe('purchase schemas', () => {
  const base = { supplierId: id, branchId: id2, orderDate: '2026-11-12' };
  const line = { itemId: id, quantity: '2', unitPrice: '10.50', gstRate: 12 };

  it('accepts a normal order', () => {
    expect(createOrderInputSchema.safeParse({ ...base, lines: [line] }).success).toBe(true);
  });

  it('rejects bad lines without throwing', () => {
    for (const bad of [
      { ...line, quantity: '0' },
      { ...line, unitPrice: '1e3' },
      { ...line, unitPrice: '-1' },
      { ...line, unitPrice: '1.999' },
      { ...line, gstRate: 7 },
      { ...line, gstRate: 7.5 },
      { ...line, quantity: 'x' },
      { ...line, quantity: '99999999999.999', unitPrice: '999999999999.99' },
    ]) {
      expect(
        createOrderInputSchema.safeParse({ ...base, lines: [bad] }).success,
        JSON.stringify(bad),
      ).toBe(false);
    }
  });

  it('rejects duplicate items, empty orders and a backwards expected date', () => {
    expect(createOrderInputSchema.safeParse({ ...base, lines: [line, line] }).success).toBe(false);
    expect(createOrderInputSchema.safeParse({ ...base, lines: [] }).success).toBe(false);
    expect(
      createOrderInputSchema.safeParse({ ...base, expectedDate: '2026-11-01', lines: [line] })
        .success,
    ).toBe(false);
  });

  it('is strict: client totals are refused', () => {
    expect(
      createOrderInputSchema.safeParse({ ...base, grandTotal: '1', lines: [line] }).success,
    ).toBe(false);
  });

  it('normalises a supplier and checks the GSTIN shape', () => {
    const ok = createSupplierInputSchema.parse({
      code: 'sup-1',
      name: ' Acme  Traders ',
      gstin: '33aabcu9603r1zx',
    });
    expect(ok).toMatchObject({ code: 'SUP-1', name: 'Acme Traders', gstin: '33AABCU9603R1ZX' });
    expect(
      createSupplierInputSchema.safeParse({ code: 'SUP-1', name: 'Acme', gstin: '123' }).success,
    ).toBe(false);
  });

  it('needs unique lines to receive', () => {
    const l = { orderLineId: id, quantity: '1' };
    expect(
      receiveGoodsInputSchema.safeParse({ orderId: id, warehouseId: id2, lines: [l] }).success,
    ).toBe(true);
    expect(
      receiveGoodsInputSchema.safeParse({ orderId: id, warehouseId: id2, lines: [l, l] }).success,
    ).toBe(false);
  });
});
