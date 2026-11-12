import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps, version } from './columns';
import { branches, organisations, recordStatus, users } from './tenancy';
import { items, warehouses } from './store';

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'restrict' });

const quantity = (name: string) => numeric(name, { precision: 14, scale: 3 });
/** Money is exact: numeric with two decimals, never floating point. */
const money = (name: string, precision = 18) => numeric(name, { precision, scale: 2 });

export const orderStatus = pgEnum('purchase_order_status', [
  'draft',
  'approved',
  'partly_received',
  'received',
  'cancelled',
]);

/** Hands out gap-free document numbers (PO-000001 ...) per organisation and kind. */
export const documentCounters = pgTable(
  'document_counters',
  {
    tenantId: tenantId(),
    kind: text('kind').notNull(),
    lastValue: integer('last_value').notNull().default(0),
  },
  (t) => [primaryKey({ name: 'document_counters_pk', columns: [t.tenantId, t.kind] })],
);

export const suppliers = pgTable(
  'suppliers',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    contactName: text('contact_name'),
    email: text('email'),
    phone: text('phone'),
    gstin: text('gstin'),
    address: text('address'),
    status: recordStatus('status').notNull().default('active'),
    ...timestamps,
    version: version(),
  },
  (t) => [
    unique('suppliers_tenant_code_unique').on(t.tenantId, t.code),
    unique('suppliers_tenant_id_unique').on(t.tenantId, t.id),
  ],
);

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    supplierId: uuid('supplier_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    status: orderStatus('status').notNull().default('draft'),
    orderDate: date('order_date', { mode: 'string' }).notNull(),
    expectedDate: date('expected_date', { mode: 'string' }),
    notes: text('notes'),
    /** Worked out by the server from the lines; a client never supplies them. */
    subtotal: money('subtotal').notNull().default('0'),
    taxTotal: money('tax_total').notNull().default('0'),
    grandTotal: money('grand_total').notNull().default('0'),
    createdBy: uuid('created_by').notNull(),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    ...timestamps,
    version: version(),
  },
  (t) => [
    unique('purchase_orders_tenant_number_unique').on(t.tenantId, t.number),
    unique('purchase_orders_tenant_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'purchase_orders_supplier_fk',
      columns: [t.tenantId, t.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'purchase_orders_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'purchase_orders_created_by_fk',
      columns: [t.tenantId, t.createdBy],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'purchase_orders_approved_by_fk',
      columns: [t.tenantId, t.approvedBy],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('restrict'),
    // The approver is always someone other than the author.
    check(
      'purchase_orders_approver_differs',
      sql`${t.approvedBy} is null or ${t.approvedBy} <> ${t.createdBy}`,
    ),
    index('purchase_orders_list_idx').on(t.tenantId, t.createdAt),
    index('purchase_orders_supplier_idx').on(t.tenantId, t.supplierId),
  ],
);

export const purchaseOrderLines = pgTable(
  'purchase_order_lines',
  {
    id: id(),
    tenantId: tenantId(),
    orderId: uuid('order_id').notNull(),
    itemId: uuid('item_id').notNull(),
    quantity: quantity('quantity').notNull(),
    /** Total received so far across all receipts; never above the ordered quantity. */
    receivedQuantity: quantity('received_quantity').notNull().default('0'),
    unitPrice: money('unit_price', 14).notNull(),
    gstRate: smallint('gst_rate').notNull(),
    subtotal: money('subtotal').notNull(),
    taxAmount: money('tax_amount').notNull(),
    total: money('total').notNull(),
  },
  (t) => [
    unique('purchase_order_lines_order_item_unique').on(t.orderId, t.itemId),
    unique('purchase_order_lines_tenant_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'purchase_order_lines_order_fk',
      columns: [t.tenantId, t.orderId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'purchase_order_lines_item_fk',
      columns: [t.tenantId, t.itemId],
      foreignColumns: [items.tenantId, items.id],
    }).onDelete('restrict'),
    check('purchase_order_lines_qty_positive', sql`${t.quantity} > 0`),
    // The database itself refuses over-receiving, whatever the application does.
    check(
      'purchase_order_lines_received_range',
      sql`${t.receivedQuantity} >= 0 and ${t.receivedQuantity} <= ${t.quantity}`,
    ),
    check('purchase_order_lines_price_positive', sql`${t.unitPrice} > 0`),
    check('purchase_order_lines_gst_rate', sql`${t.gstRate} in (0, 5, 12, 18, 28)`),
  ],
);

/** A delivery against an order. Append-only: a mistake is fixed with a stock adjustment. */
export const goodsReceipts = pgTable(
  'goods_receipts',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    orderId: uuid('order_id').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    supplierInvoiceNo: text('supplier_invoice_no'),
    notes: text('notes'),
    receivedBy: uuid('received_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('goods_receipts_tenant_number_unique').on(t.tenantId, t.number),
    unique('goods_receipts_tenant_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'goods_receipts_order_fk',
      columns: [t.tenantId, t.orderId],
      foreignColumns: [purchaseOrders.tenantId, purchaseOrders.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'goods_receipts_warehouse_fk',
      columns: [t.tenantId, t.warehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'goods_receipts_received_by_fk',
      columns: [t.tenantId, t.receivedBy],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('restrict'),
    index('goods_receipts_order_idx').on(t.tenantId, t.orderId, t.createdAt),
  ],
);

export const goodsReceiptLines = pgTable(
  'goods_receipt_lines',
  {
    id: id(),
    tenantId: tenantId(),
    receiptId: uuid('receipt_id').notNull(),
    orderLineId: uuid('order_line_id').notNull(),
    itemId: uuid('item_id').notNull(),
    quantity: quantity('quantity').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'goods_receipt_lines_receipt_fk',
      columns: [t.tenantId, t.receiptId],
      foreignColumns: [goodsReceipts.tenantId, goodsReceipts.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'goods_receipt_lines_order_line_fk',
      columns: [t.tenantId, t.orderLineId],
      foreignColumns: [purchaseOrderLines.tenantId, purchaseOrderLines.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'goods_receipt_lines_item_fk',
      columns: [t.tenantId, t.itemId],
      foreignColumns: [items.tenantId, items.id],
    }).onDelete('restrict'),
    check('goods_receipt_lines_qty_positive', sql`${t.quantity} > 0`),
    index('goods_receipt_lines_receipt_idx').on(t.tenantId, t.receiptId),
  ],
);
