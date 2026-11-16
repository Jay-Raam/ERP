import { z } from 'zod';
import { dateSchema } from './hr';
import {
  orderLinesSchema,
  orderDecisionInputSchema,
  pageFields,
  partyEditable,
  searchText,
  uuid,
  expectedNotBefore,
} from './purchase';
import { positiveQuantity, warehouseCodeSchema } from './store';
import { optionalText } from './text';

// ------------------------------------------------------------------ customers

export const createCustomerInputSchema = z.strictObject({
  code: warehouseCodeSchema,
  ...partyEditable,
});

/** The code is fixed once orders can refer to it. */
export const updateCustomerInputSchema = z.strictObject({
  ...partyEditable,
  status: z.enum(['active', 'inactive']),
  version: z.number().int().min(1),
});

export const listCustomersInputSchema = z.strictObject({
  search: searchText,
  status: z
    .enum(['active', 'inactive'])
    .nullish()
    .transform((v) => v ?? undefined),
  ...pageFields,
});

// --------------------------------------------------------------- sales orders

const salesEditable = {
  customerId: uuid,
  orderDate: dateSchema,
  expectedDate: dateSchema.nullish().transform((v) => v ?? null),
  notes: optionalText('Notes', 300),
  lines: orderLinesSchema,
};

export const createSalesOrderInputSchema = z
  .strictObject({ branchId: uuid, ...salesEditable })
  .superRefine(expectedNotBefore);

export const updateSalesOrderInputSchema = z
  .strictObject({ ...salesEditable, version: z.number().int().min(1) })
  .superRefine(expectedNotBefore);

/** What the order form edits: the branch is chosen once, so the form carries it as optional. */
export const salesOrderFormSchema = z
  .object({
    branchId: uuid.optional(),
    ...salesEditable,
    expectedDate: z
      .preprocess((v) => (v === '' ? null : v), dateSchema.nullish())
      .transform((v) => v ?? null),
  })
  .superRefine(expectedNotBefore);

export const SALES_ORDER_STATUSES = [
  'draft',
  'confirmed',
  'partly_delivered',
  'delivered',
  'cancelled',
] as const;
export type SalesOrderStatus = (typeof SALES_ORDER_STATUSES)[number];

export const listSalesOrdersInputSchema = z.strictObject({
  search: searchText,
  status: z
    .enum(SALES_ORDER_STATUSES)
    .nullish()
    .transform((v) => v ?? undefined),
  customerId: uuid.nullish().transform((v) => v ?? undefined),
  ...pageFields,
});

export const salesDecisionInputSchema = orderDecisionInputSchema;

// ----------------------------------------------------------------- deliveries

export const deliverGoodsInputSchema = z.strictObject({
  orderId: uuid,
  warehouseId: uuid,
  reference: optionalText('Reference', 40),
  notes: optionalText('Notes', 300),
  lines: z
    .array(z.strictObject({ orderLineId: uuid, quantity: positiveQuantity }))
    .min(1, 'Enter a quantity for at least one line')
    .max(100)
    .refine((lines) => new Set(lines.map((l) => l.orderLineId)).size === lines.length, {
      message: 'Each line can appear only once',
    }),
});
