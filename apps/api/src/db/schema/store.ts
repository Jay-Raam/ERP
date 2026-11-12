import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps, version } from './columns';
import { branches, organisations, recordStatus, users } from './tenancy';

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'restrict' });

/** Quantities keep three decimals (kg, litres, metres) and are exact: never floating point. */
const quantity = (name: string) => numeric(name, { precision: 14, scale: 3 });

export const movementKind = pgEnum('stock_movement_kind', [
  'receipt',
  'issue',
  'adjustment',
  'transfer_out',
  'transfer_in',
]);

export const items = pgTable(
  'items',
  {
    id: id(),
    tenantId: tenantId(),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    unit: text('unit').notNull(),
    category: text('category'),
    /** At or below this total on hand, the item is flagged as low. 0 means "never flag". */
    reorderLevel: quantity('reorder_level').notNull().default('0'),
    status: recordStatus('status').notNull().default('active'),
    ...timestamps,
    version: version(),
  },
  (t) => [
    unique('items_tenant_sku_unique').on(t.tenantId, t.sku),
    unique('items_tenant_id_unique').on(t.tenantId, t.id),
    check('items_reorder_level_nonneg', sql`${t.reorderLevel} >= 0`),
  ],
);

export const warehouses = pgTable(
  'warehouses',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    branchId: uuid('branch_id').notNull(),
    status: recordStatus('status').notNull().default('active'),
    ...timestamps,
    version: version(),
  },
  (t) => [
    unique('warehouses_tenant_code_unique').on(t.tenantId, t.code),
    unique('warehouses_tenant_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'warehouses_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }).onDelete('restrict'),
  ],
);

/** Current quantity per item and warehouse. Changed only together with a stock_movements row. */
export const stockBalances = pgTable(
  'stock_balances',
  {
    tenantId: tenantId(),
    itemId: uuid('item_id').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    quantity: quantity('quantity').notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'stock_balances_pk', columns: [t.tenantId, t.itemId, t.warehouseId] }),
    // The database itself refuses negative stock, whatever the application does.
    check('stock_balances_nonneg', sql`${t.quantity} >= 0`),
    foreignKey({
      name: 'stock_balances_item_fk',
      columns: [t.tenantId, t.itemId],
      foreignColumns: [items.tenantId, items.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'stock_balances_warehouse_fk',
      columns: [t.tenantId, t.warehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id],
    }).onDelete('restrict'),
  ],
);

/** The stock ledger. Append-only: a mistake is corrected with another movement, never an edit. */
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: id(),
    tenantId: tenantId(),
    itemId: uuid('item_id').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    kind: movementKind('kind').notNull(),
    /** Signed: positive adds stock, negative removes it. */
    quantity: quantity('quantity').notNull(),
    balanceAfter: quantity('balance_after').notNull(),
    /** Ties the two legs of one transfer together. */
    transferId: uuid('transfer_id'),
    reference: text('reference'),
    reason: text('reason'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('stock_movements_nonzero', sql`${t.quantity} <> 0`),
    foreignKey({
      name: 'stock_movements_item_fk',
      columns: [t.tenantId, t.itemId],
      foreignColumns: [items.tenantId, items.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'stock_movements_warehouse_fk',
      columns: [t.tenantId, t.warehouseId],
      foreignColumns: [warehouses.tenantId, warehouses.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'stock_movements_created_by_fk',
      columns: [t.tenantId, t.createdBy],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('restrict'),
    index('stock_movements_item_idx').on(t.tenantId, t.itemId, t.createdAt),
    index('stock_movements_warehouse_idx').on(t.tenantId, t.warehouseId, t.createdAt),
  ],
);
