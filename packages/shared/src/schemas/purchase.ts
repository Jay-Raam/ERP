import { z } from 'zod';
import { GST_RATES, MAX_LINE_PAISE, lineAmounts } from '../purchase-math';
import { emailSchema } from './auth';
import { dateSchema } from './hr';
import { positiveQuantity, warehouseCodeSchema } from './store';
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

const searchText = z
  .string()
  .max(80)
  .nullish()
  .transform((v) => (v ? cleanText(v) || undefined : undefined));

// ----------------------------------------------------------------- suppliers

const optionalEmail = z
  .string()
  .nullish()
  .transform((v) => (v ? v.trim() : null))
  .pipe(z.union([z.null(), emailSchema]));

const optionalPhone = z
  .string()
  .nullish()
  .transform((v) => (v ? v.trim() : null))
  .pipe(
    z
      .string()
      .regex(/^\+?[0-9][0-9 -]{5,18}[0-9]$/, 'Enter a valid phone number')
      .nullable(),
  );

/** 15 characters: state code, PAN, entity number, "Z", check character. */
const optionalGstin = z
  .string()
  .nullish()
  .transform((v) => (v ? v.trim().toUpperCase() : null))
  .pipe(
    z
      .string()
      .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN')
      .nullable(),
  );

const supplierEditable = {
  name: plainText('Supplier name', 2, 120),
  contactName: optionalText('Contact name', 80),
  email: optionalEmail,
  phone: optionalPhone,
  gstin: optionalGstin,
  address: optionalText('Address', 300),
};

export const createSupplierInputSchema = z.strictObject({
  code: warehouseCodeSchema,
  ...supplierEditable,
});

/** The code is fixed once orders can refer to it. */
export const updateSupplierInputSchema = z.strictObject({
  ...supplierEditable,
  status: z.enum(['active', 'inactive']),
  version: z.number().int().min(1),
});

export const listSuppliersInputSchema = z.strictObject({
  search: searchText,
  status: z
    .enum(['active', 'inactive'])
    .nullish()
    .transform((v) => v ?? undefined),
  ...pageFields,
});

// ------------------------------------------------------------ purchase orders

/** Up to 12 whole digits and 2 decimals, more than zero. */
export const unitPriceSchema = z
  .string()
  .trim()
  .regex(/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/, 'Enter a price like 120 or 99.50')
  .refine((p) => Number(p) > 0, 'Price must be more than zero');

export const gstRateSchema = z
  .number()
  .refine((r) => (GST_RATES as readonly number[]).includes(r), 'GST must be 0, 5, 12, 18 or 28');

export const MAX_ORDER_LINES = 100;

const orderLineSchema = z
  .strictObject({
    itemId: uuid,
    quantity: positiveQuantity,
    unitPrice: unitPriceSchema,
    gstRate: gstRateSchema,
  })
  .superRefine((line, ctx) => {
    // Refinements also run when a field is invalid, so only do the sum with usable values.
    const usable =
      positiveQuantity.safeParse(line.quantity).success &&
      unitPriceSchema.safeParse(line.unitPrice).success &&
      Number.isInteger(line.gstRate);
    if (
      usable &&
      lineAmounts(line.quantity, line.unitPrice, line.gstRate).subtotal > MAX_LINE_PAISE
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['quantity'],
        message: 'This line amount is too large',
      });
    }
  });

export const orderLinesSchema = z
  .array(orderLineSchema)
  .min(1, 'Add at least one line')
  .max(MAX_ORDER_LINES, `At most ${MAX_ORDER_LINES} lines`)
  .refine((lines) => new Set(lines.map((l) => l.itemId)).size === lines.length, {
    message: 'Each item can appear only once',
  });

const orderEditable = {
  supplierId: uuid,
  orderDate: dateSchema,
  expectedDate: dateSchema.nullish().transform((v) => v ?? null),
  notes: optionalText('Notes', 300),
  lines: orderLinesSchema,
};

function expectedNotBefore(
  v: { orderDate: string; expectedDate: string | null },
  ctx: z.RefinementCtx,
) {
  if (v.expectedDate && v.expectedDate < v.orderDate) {
    ctx.addIssue({
      code: 'custom',
      path: ['expectedDate'],
      message: 'Expected date cannot be before the order date',
    });
  }
}

export const createOrderInputSchema = z
  .strictObject({ branchId: uuid, ...orderEditable })
  .superRefine(expectedNotBefore);

/** The branch is fixed once an order exists: branch-scoped access depends on it. */
export const updateOrderInputSchema = z
  .strictObject({ ...orderEditable, version: z.number().int().min(1) })
  .superRefine(expectedNotBefore);

/**
 * What the order form edits. The branch is chosen once, when the order is created, so the
 * form carries it as optional. (The strict API schemas cannot be reused with `.omit()`.)
 */
export const orderFormSchema = z
  .object({
    branchId: uuid.optional(),
    ...orderEditable,
    // An empty date input arrives as "".
    expectedDate: z
      .preprocess((v) => (v === '' ? null : v), dateSchema.nullish())
      .transform((v) => v ?? null),
  })
  .superRefine(expectedNotBefore);

export const ORDER_STATUSES = [
  'draft',
  'approved',
  'partly_received',
  'received',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const listOrdersInputSchema = z.strictObject({
  search: searchText,
  status: z
    .enum(ORDER_STATUSES)
    .nullish()
    .transform((v) => v ?? undefined),
  supplierId: uuid.nullish().transform((v) => v ?? undefined),
  ...pageFields,
});

export const orderDecisionInputSchema = z.strictObject({
  version: z.number().int().min(1),
});

// ----------------------------------------------------------------- receiving

export const receiveGoodsInputSchema = z.strictObject({
  orderId: uuid,
  warehouseId: uuid,
  supplierInvoiceNo: optionalText('Supplier invoice number', 40),
  notes: optionalText('Notes', 300),
  lines: z
    .array(z.strictObject({ orderLineId: uuid, quantity: positiveQuantity }))
    .min(1, 'Enter a quantity for at least one line')
    .max(MAX_ORDER_LINES)
    .refine((lines) => new Set(lines.map((l) => l.orderLineId)).size === lines.length, {
      message: 'Each line can appear only once',
    }),
});
