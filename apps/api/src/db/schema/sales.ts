import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgEnum,
  pgTable,
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
const money = (name: string, precision = 18) => numeric(name, { precision, scale: 2 });

export const salesOrderStatus = pgEnum('sales_order_status', [
  'draft',
  'confirmed',
  'partly_delivered',
  'delivered',
  'cancelled',
]);

export const customers = pgTable(
  'customers',
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
    unique('customers_tenant_code_unique').on(t.tenantId, t.code),
    unique('customers_tenant_id_unique').on(t.tenantId, t.id),
  ],
);

export const salesOrders = pgTable(
  'sales_orders',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    customerId: uuid('customer_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    status: salesOrderStatus('status').notNull().default('draft'),
    orderDate: date('order_date', { mode: 'string' }).notNull(),
    expectedDate: date('expected_date', { mode: 'string' }),
    notes: text('notes'),
    /** Worked out by the server from the lines; a client never supplies them. */
    subtotal: money('subtotal').notNull().default('0'),
    taxTotal: money('tax_total').notNull().default('0'),
    grandTotal: money('grand_total').notNull().default('0'),
    createdBy: uuid('created_by').notNull(),
    confirmedBy: uuid('confirmed_by'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    ...timestamps,
    version: version(),
  },
  (t) => [
    unique('sales_orders_tenant_number_unique').on(t.tenantId, t.number),
    unique('sales_orders_tenant_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'sales_orders_supplier_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'sales_orders_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'sales_orders_created_by_fk',
      columns: [t.tenantId, t.createdBy],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'sales_orders_confirmed_by_fk',
      columns: [t.tenantId, t.confirmedBy],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('restrict'),
    // The person who confirms is always someone other than the author.
    check(
      'sales_orders_confirmer_differs',
      sql`${t.confirmedBy} is null or ${t.confirmedBy} <> ${t.createdBy}`,
    ),
    index('sales_orders_list_idx').on(t.tenantId, t.createdAt),
    index('sales_orders_customer_idx').on(t.tenantId, t.customerId),
  ],
);

export const salesOrderLines = pgTable(
  'sales_order_lines',
  {
    id: id(),
    tenantId: tenantId(),
    orderId: uuid('order_id').notNull(),
    itemId: uuid('item_id').notNull(),
    quantity: quantity('quantity').notNull(),
    /** Total delivered so far across all deliveries; never above the ordered quantity. */
    deliveredQuantity: quantity('delivered_quantity').notNull().default('0'),
    unitPrice: money('unit_price', 14).notNull(),
    gstRate: smallint('gst_rate').notNull(),
    subtotal: money('subtotal').notNull(),
    taxAmount: money('tax_amount').notNull(),
    total: money('total').notNull(),
  },
  (t) => [
    unique('sales_order_lines_order_item_unique').on(t.orderId, t.itemId),
    unique('sales_order_lines_tenant_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'sales_order_lines_order_fk',
      columns: [t.tenantId, t.orderId],
      foreignColumns: [salesOrders.tenantId, salesOrders.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'sales_order_lines_item_fk',
      columns: [t.tenantId, t.itemId],
      foreignColumns: [items.tenantId, items.id],
    }).onDelete('restrict'),
    check('sales_order_lines_qty_positive', sql`${t.quantity} > 0`),
    // The database itself refuses over-delivering, whatever the application does.
    check(
      'sales_order_lines_delivered_range',
      sql`${t.deliveredQuantity} >= 0 and ${t.deliveredQuantity} <= ${t.quantity}`,
    ),
    check('sales_order_lines_price_positive', sql`${t.unitPrice} > 0`),
    check('sales_order_lines_gst_rate', sql`${t.gstRate} in (0, 5, 12, 18, 28)`),
  ],
);

/** A delivery against an order, issuing stock. Append-only: a mistake is fixed with a stock adjustment. */
export const deliveries = pgTable(
  'deliveries',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    orderId: uuid('order_id').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    reference: text('reference'),
    notes: text('notes'),
    deliveredBy: uuid('delivered_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('deliveries_tenant_number_unique').on(t.tenantId, t.number),
    unique('deliveries_tenant_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'deliveries_order_fk',
      columns: [t.tenantId, t.orderId],
      foreignColumns: [salesOrders.tenantId, salesOrders.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'deliveries_warehouse_fk',
      columns: [t.tenantId, t.warehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'deliveries_delivered_by_fk',
      columns: [t.tenantId, t.deliveredBy],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('restrict'),
    index('deliveries_order_idx').on(t.tenantId, t.orderId, t.createdAt),
  ],
);

export const deliveryLines = pgTable(
  'delivery_lines',
  {
    id: id(),
    tenantId: tenantId(),
    deliveryId: uuid('delivery_id').notNull(),
    orderLineId: uuid('order_line_id').notNull(),
    itemId: uuid('item_id').notNull(),
    quantity: quantity('quantity').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'delivery_lines_delivery_fk',
      columns: [t.tenantId, t.deliveryId],
      foreignColumns: [deliveries.tenantId, deliveries.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'delivery_lines_order_line_fk',
      columns: [t.tenantId, t.orderLineId],
      foreignColumns: [salesOrderLines.tenantId, salesOrderLines.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'delivery_lines_item_fk',
      columns: [t.tenantId, t.itemId],
      foreignColumns: [items.tenantId, items.id],
    }).onDelete('restrict'),
    check('delivery_lines_qty_positive', sql`${t.quantity} > 0`),
    index('delivery_lines_delivery_idx').on(t.tenantId, t.deliveryId),
  ],
);
