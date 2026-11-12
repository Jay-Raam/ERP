import { z } from 'zod';
import { cleanText, optionalText, plainText } from './text';

const uuid = z.uuid('Invalid id');

const nullishInt = (min: number, max: number, fallback: number) =>
  z
    .number()
    .int()
    .min(min)
    .max(max)
    .nullish()
    .transform((v) => v ?? fallback);

const pageFields = {
  limit: nullishInt(1, 100, 25),
  offset: nullishInt(0, 100_000, 0),
};

// ---------------------------------------------------------------- quantities

/**
 * Quantities travel as decimal strings so nothing is ever rounded by floating point:
 * up to 11 whole digits and 3 decimals ("12", "0.5", "1250.375").
 */
const QUANTITY = /^(0|[1-9][0-9]{0,10})(\.[0-9]{1,3})?$/;
/** The most one warehouse can hold: the largest value of the numeric(14,3) column. */
export const MAX_STOCK = '99999999999.999';
const isZero = (q: string) => Number(q) === 0;

export const positiveQuantity = z
  .string()
  .trim()
  .regex(QUANTITY, 'Enter a quantity like 12 or 2.5 (up to 3 decimals)')
  .refine((q) => !isZero(q), 'Quantity must be more than zero');

export const nonNegativeQuantity = z
  .string()
  .trim()
  .regex(QUANTITY, 'Enter a quantity like 12 or 2.5 (up to 3 decimals)');

/** An adjustment adds (positive) or removes (negative) stock. */
export const signedQuantity = z
  .string()
  .trim()
  .regex(/^-?(0|[1-9][0-9]{0,10})(\.[0-9]{1,3})?$/, 'Enter a quantity like 5 or -2.5')
  .refine((q) => !isZero(q), 'Quantity must not be zero');

/** Search text: control and invisible characters are dropped, so a NUL byte cannot reach the database. */
const searchText = z
  .string()
  .max(80)
  .nullish()
  .transform((v) => (v ? cleanText(v) || undefined : undefined));

// --------------------------------------------------------------------- items

export const UNITS = ['pcs', 'kg', 'g', 'l', 'ml', 'm', 'box', 'pack', 'set', 'dozen'] as const;
export type Unit = (typeof UNITS)[number];

export const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'SKU must be at least 2 characters')
  .max(32, 'SKU must be at most 32 characters')
  .regex(/^[A-Z0-9][A-Z0-9._-]*$/, 'Use letters, numbers, dots, hyphens and underscores only');

const itemEditable = {
  name: plainText('Item name', 2, 120),
  category: optionalText('Category', 60),
  reorderLevel: nonNegativeQuantity.default('0'),
};

export const createItemInputSchema = z.strictObject({
  sku: skuSchema,
  unit: z.enum(UNITS),
  ...itemEditable,
});

/** SKU and unit are fixed once an item exists: the ledger's quantities are in that unit. */
export const updateItemInputSchema = z.strictObject({
  ...itemEditable,
  status: z.enum(['active', 'inactive']),
  version: z.number().int().min(1),
});

export const listItemsInputSchema = z.strictObject({
  search: searchText,
  status: z
    .enum(['active', 'inactive'])
    .nullish()
    .transform((v) => v ?? undefined),
  ...pageFields,
});

// ---------------------------------------------------------------- warehouses

export const warehouseCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'Code must be at least 2 characters')
  .max(20, 'Code must be at most 20 characters')
  .regex(/^[A-Z0-9][A-Z0-9-]*$/, 'Use letters, numbers and hyphens only');

export const createWarehouseInputSchema = z.strictObject({
  code: warehouseCodeSchema,
  name: plainText('Warehouse name', 2, 80),
  branchId: uuid,
});

/** The branch is fixed once a warehouse exists: branch-scoped access depends on it. */
export const updateWarehouseInputSchema = z.strictObject({
  name: plainText('Warehouse name', 2, 80),
  status: z.enum(['active', 'inactive']),
  version: z.number().int().min(1),
});

export const listWarehousesInputSchema = z.strictObject({
  branchId: uuid.nullish().transform((v) => v ?? undefined),
  status: z
    .enum(['active', 'inactive'])
    .nullish()
    .transform((v) => v ?? undefined),
});

// -------------------------------------------------------------------- stock

const note = (label: string) => optionalText(label, 200);

export const receiveStockInputSchema = z.strictObject({
  itemId: uuid,
  warehouseId: uuid,
  quantity: positiveQuantity,
  reference: note('Reference'),
  reason: note('Note'),
});

export const issueStockInputSchema = receiveStockInputSchema;

export const adjustStockInputSchema = z.strictObject({
  itemId: uuid,
  warehouseId: uuid,
  quantity: signedQuantity,
  /** An adjustment changes stock without a document, so it always needs a reason. */
  reason: plainText('Reason', 3, 200),
});

export const transferStockInputSchema = z
  .strictObject({
    itemId: uuid,
    fromWarehouseId: uuid,
    toWarehouseId: uuid,
    quantity: positiveQuantity,
    reference: note('Reference'),
    reason: note('Note'),
  })
  .superRefine((v, ctx) => {
    if (v.fromWarehouseId === v.toWarehouseId) {
      ctx.addIssue({
        code: 'custom',
        path: ['toWarehouseId'],
        message: 'Choose a different warehouse to transfer to',
      });
    }
  });

export const MOVEMENT_KINDS = [
  'receipt',
  'issue',
  'adjustment',
  'transfer_out',
  'transfer_in',
] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const stockLevelsInputSchema = z.strictObject({
  search: searchText,
  warehouseId: uuid.nullish().transform((v) => v ?? undefined),
  lowOnly: z
    .boolean()
    .nullish()
    .transform((v) => v ?? false),
  ...pageFields,
});

export const movementsInputSchema = z.strictObject({
  itemId: uuid.nullish().transform((v) => v ?? undefined),
  warehouseId: uuid.nullish().transform((v) => v ?? undefined),
  kind: z
    .enum(MOVEMENT_KINDS)
    .nullish()
    .transform((v) => v ?? undefined),
  ...pageFields,
});
