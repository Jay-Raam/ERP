import {
  adjustStockInputSchema,
  createItemInputSchema,
  createWarehouseInputSchema,
  receiveStockInputSchema,
  transferStockInputSchema,
} from '@erp/shared';
import { describe, expect, it } from 'vitest';

const id = '00000000-0000-4000-8000-000000000001';
const id2 = '00000000-0000-4000-8000-000000000002';

describe('store form schemas', () => {
  it('normalises an item', () => {
    const r = createItemInputSchema.parse({ sku: ' ab-1 ', unit: 'kg', name: ' Rice ' });
    expect(r).toMatchObject({ sku: 'AB-1', name: 'Rice', reorderLevel: '0', category: null });
  });
  it('rejects unknown units and bad reorder levels', () => {
    expect(createItemInputSchema.safeParse({ sku: 'AB', unit: 'x', name: 'Rice' }).success).toBe(
      false,
    );
    expect(
      createItemInputSchema.safeParse({ sku: 'AB', unit: 'kg', name: 'Rice', reorderLevel: '-1' })
        .success,
    ).toBe(false);
  });
  it('accepts exact decimals and refuses zero or float-style quantities', () => {
    const base = { itemId: id, warehouseId: id2 };
    expect(receiveStockInputSchema.safeParse({ ...base, quantity: '2.5' }).success).toBe(true);
    for (const quantity of ['0', '-1', '1e3', '1.2345', '']) {
      expect(receiveStockInputSchema.safeParse({ ...base, quantity }).success, quantity).toBe(
        false,
      );
    }
  });
  it('needs a reason for an adjustment, and allows a negative quantity', () => {
    const base = { itemId: id, warehouseId: id2, quantity: '-2' };
    expect(adjustStockInputSchema.safeParse(base).success).toBe(false);
    expect(adjustStockInputSchema.safeParse({ ...base, reason: 'Damaged' }).success).toBe(true);
  });
  it('refuses a transfer to the same warehouse', () => {
    const r = transferStockInputSchema.safeParse({
      itemId: id,
      fromWarehouseId: id2,
      toWarehouseId: id2,
      quantity: '1',
    });
    expect(r.success).toBe(false);
  });
  it('uppercases a warehouse code', () => {
    expect(
      createWarehouseInputSchema.parse({ code: 'cold-1', name: 'Cold room', branchId: id }).code,
    ).toBe('COLD-1');
  });
});
