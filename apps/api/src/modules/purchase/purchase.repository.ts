import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { OrderStatus } from '@erp/shared';
import type { TenantTx } from '../../db/client';
import {
  branches,
  goodsReceiptLines,
  goodsReceipts,
  items,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
  users,
  warehouses,
} from '../../db/schema';
import type { Scope } from '../hr/scope';
import { likePattern } from '../hr/employees.repository';

// ---------------------------------------------------------------- suppliers

export type SupplierRow = {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  gstin: string | null;
  address: string | null;
  status: 'active' | 'inactive';
  version: number;
};

const supplierColumns = {
  id: suppliers.id,
  code: suppliers.code,
  name: suppliers.name,
  contactName: suppliers.contactName,
  email: suppliers.email,
  phone: suppliers.phone,
  gstin: suppliers.gstin,
  address: suppliers.address,
  status: suppliers.status,
  version: suppliers.version,
};

export async function listSuppliers(
  tx: TenantTx,
  filter: { search?: string; status?: 'active' | 'inactive'; limit: number; offset: number },
) {
  const where = and(
    filter.search
      ? or(
          ilike(suppliers.name, likePattern(filter.search)),
          ilike(suppliers.code, likePattern(filter.search)),
          ilike(suppliers.gstin, likePattern(filter.search)),
        )
      : undefined,
    filter.status ? eq(suppliers.status, filter.status) : undefined,
  );
  const rows = await tx
    .select(supplierColumns)
    .from(suppliers)
    .where(where)
    .orderBy(asc(suppliers.name), asc(suppliers.id))
    .limit(filter.limit)
    .offset(filter.offset);
  const [count] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(suppliers)
    .where(where);
  return { items: rows as SupplierRow[], total: count!.n };
}

export async function findSupplier(tx: TenantTx, id: string): Promise<SupplierRow | null> {
  const [row] = await tx
    .select(supplierColumns)
    .from(suppliers)
    .where(eq(suppliers.id, id))
    .limit(1);
  return (row as SupplierRow | undefined) ?? null;
}

export async function insertSupplier(
  tx: TenantTx,
  values: {
    tenantId: string;
    code: string;
    name: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    gstin: string | null;
    address: string | null;
  },
): Promise<string> {
  const [row] = await tx.insert(suppliers).values(values).returning({ id: suppliers.id });
  return row!.id;
}

/** Returns false when the version is stale. */
export async function updateSupplier(
  tx: TenantTx,
  id: string,
  version: number,
  values: {
    name: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    gstin: string | null;
    address: string | null;
    status: 'active' | 'inactive';
  },
): Promise<boolean> {
  const rows = await tx
    .update(suppliers)
    .set({ ...values, version: sql`${suppliers.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(suppliers.id, id), eq(suppliers.version, version)))
    .returning({ id: suppliers.id });
  return rows.length > 0;
}

// ------------------------------------------------------------------ numbers

/** Next document number for this kind, e.g. PO-000007. Rolls back with the transaction: no gaps. */
export async function nextNumber(
  tx: TenantTx,
  tenantId: string,
  kind: 'PO' | 'GRN',
): Promise<string> {
  const rows = await tx.execute<{ last_value: number }>(sql`
    insert into document_counters (tenant_id, kind, last_value)
    values (${tenantId}, ${kind}, 1)
    on conflict (tenant_id, kind)
    do update set last_value = document_counters.last_value + 1
    returning last_value`);
  return `${kind}-${String(rows[0]!.last_value).padStart(6, '0')}`;
}

// ------------------------------------------------------------------- orders

/** Orders belong to a branch. Branch roles see their branches' orders; "own" roles only their own. */
function orderScope(scope: Scope, userId: string): SQL | undefined {
  switch (scope.kind) {
    case 'organisation':
      return undefined;
    case 'branch':
      return scope.branchIds.length > 0
        ? sql`${purchaseOrders.branchId} in (${sql.join(
            scope.branchIds.map((b) => sql`${b}`),
            sql`, `,
          )})`
        : sql`false`;
    case 'own':
      return eq(purchaseOrders.createdBy, userId);
  }
}

const createdByUser = alias(users, 'created_by_user');
const approvedByUser = alias(users, 'approved_by_user');

export type OrderRow = {
  id: string;
  number: string;
  status: OrderStatus;
  orderDate: string;
  expectedDate: string | null;
  notes: string | null;
  subtotal: string;
  taxTotal: string;
  grandTotal: string;
  version: number;
  createdAt: Date;
  approvedAt: Date | null;
  cancelledAt: Date | null;
  createdBy: string;
  createdByName: string;
  approvedBy: string | null;
  approvedByName: string | null;
  supplier: { id: string; code: string; name: string };
  branch: { id: string; code: string; name: string };
};

const orderColumns = {
  id: purchaseOrders.id,
  number: purchaseOrders.number,
  status: purchaseOrders.status,
  orderDate: purchaseOrders.orderDate,
  expectedDate: purchaseOrders.expectedDate,
  notes: purchaseOrders.notes,
  subtotal: purchaseOrders.subtotal,
  taxTotal: purchaseOrders.taxTotal,
  grandTotal: purchaseOrders.grandTotal,
  version: purchaseOrders.version,
  createdAt: purchaseOrders.createdAt,
  approvedAt: purchaseOrders.approvedAt,
  cancelledAt: purchaseOrders.cancelledAt,
  createdBy: purchaseOrders.createdBy,
  createdByName: createdByUser.fullName,
  approvedBy: purchaseOrders.approvedBy,
  approvedByName: approvedByUser.fullName,
  supplierId: suppliers.id,
  supplierCode: suppliers.code,
  supplierName: suppliers.name,
  branchId: branches.id,
  branchCode: branches.code,
  branchName: branches.name,
};

const orderBase = (tx: TenantTx) =>
  tx
    .select(orderColumns)
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .innerJoin(branches, eq(branches.id, purchaseOrders.branchId))
    .innerJoin(createdByUser, eq(createdByUser.id, purchaseOrders.createdBy))
    .leftJoin(approvedByUser, eq(approvedByUser.id, purchaseOrders.approvedBy));

type OrderJoined = Awaited<ReturnType<typeof orderBase>>[number];

const shapeOrder = (r: OrderJoined): OrderRow => ({
  id: r.id,
  number: r.number,
  status: r.status,
  orderDate: r.orderDate,
  expectedDate: r.expectedDate,
  notes: r.notes,
  subtotal: r.subtotal,
  taxTotal: r.taxTotal,
  grandTotal: r.grandTotal,
  version: r.version,
  createdAt: r.createdAt,
  approvedAt: r.approvedAt,
  cancelledAt: r.cancelledAt,
  createdBy: r.createdBy,
  createdByName: r.createdByName,
  approvedBy: r.approvedBy,
  approvedByName: r.approvedByName,
  supplier: { id: r.supplierId, code: r.supplierCode, name: r.supplierName },
  branch: { id: r.branchId, code: r.branchCode, name: r.branchName },
});

export async function listOrders(
  tx: TenantTx,
  filter: {
    scope: Scope;
    userId: string;
    search?: string;
    status?: OrderStatus;
    supplierId?: string;
    limit: number;
    offset: number;
  },
) {
  const where = and(
    orderScope(filter.scope, filter.userId),
    filter.search
      ? or(
          ilike(purchaseOrders.number, likePattern(filter.search)),
          ilike(suppliers.name, likePattern(filter.search)),
        )
      : undefined,
    filter.status ? eq(purchaseOrders.status, filter.status) : undefined,
    filter.supplierId ? eq(purchaseOrders.supplierId, filter.supplierId) : undefined,
  );
  const rows = await orderBase(tx)
    .where(where)
    .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.id))
    .limit(filter.limit)
    .offset(filter.offset);
  const [count] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(where);
  return { items: rows.map((r) => shapeOrder(r)), total: count!.n };
}

export async function findOrder(tx: TenantTx, id: string): Promise<OrderRow | null> {
  const [row] = await orderBase(tx).where(eq(purchaseOrders.id, id)).limit(1);
  return row ? shapeOrder(row) : null;
}

/** Locks the order row for the rest of the transaction, so two receipts or approvals queue up. */
export async function lockOrder(tx: TenantTx, id: string) {
  const [row] = await tx
    .select({
      id: purchaseOrders.id,
      status: purchaseOrders.status,
      version: purchaseOrders.version,
      branchId: purchaseOrders.branchId,
      createdBy: purchaseOrders.createdBy,
      supplierId: purchaseOrders.supplierId,
      number: purchaseOrders.number,
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, id))
    .for('update')
    .limit(1);
  return row ?? null;
}

export async function insertOrder(
  tx: TenantTx,
  values: {
    tenantId: string;
    number: string;
    supplierId: string;
    branchId: string;
    orderDate: string;
    expectedDate: string | null;
    notes: string | null;
    subtotal: string;
    taxTotal: string;
    grandTotal: string;
    createdBy: string;
  },
): Promise<string> {
  const [row] = await tx.insert(purchaseOrders).values(values).returning({ id: purchaseOrders.id });
  return row!.id;
}

/** Draft edit. Returns false when the version is stale or the order is no longer a draft. */
export async function updateDraftOrder(
  tx: TenantTx,
  id: string,
  version: number,
  values: {
    supplierId: string;
    orderDate: string;
    expectedDate: string | null;
    notes: string | null;
    subtotal: string;
    taxTotal: string;
    grandTotal: string;
  },
): Promise<boolean> {
  const rows = await tx
    .update(purchaseOrders)
    .set({ ...values, version: sql`${purchaseOrders.version} + 1`, updatedAt: sql`now()` })
    .where(
      and(
        eq(purchaseOrders.id, id),
        eq(purchaseOrders.version, version),
        eq(purchaseOrders.status, 'draft'),
      ),
    )
    .returning({ id: purchaseOrders.id });
  return rows.length > 0;
}

export async function setOrderState(
  tx: TenantTx,
  id: string,
  values: {
    status: OrderStatus;
    approvedBy?: string;
    approvedAt?: Date;
    cancelledAt?: Date;
  },
): Promise<void> {
  await tx
    .update(purchaseOrders)
    .set({ ...values, version: sql`${purchaseOrders.version} + 1`, updatedAt: sql`now()` })
    .where(eq(purchaseOrders.id, id));
}

// -------------------------------------------------------------------- lines

export type OrderLineRow = {
  id: string;
  quantity: string;
  receivedQuantity: string;
  unitPrice: string;
  gstRate: number;
  subtotal: string;
  taxAmount: string;
  total: string;
  item: { id: string; sku: string; name: string; unit: string };
};

export async function listLines(tx: TenantTx, orderId: string): Promise<OrderLineRow[]> {
  const rows = await tx
    .select({
      id: purchaseOrderLines.id,
      quantity: purchaseOrderLines.quantity,
      receivedQuantity: purchaseOrderLines.receivedQuantity,
      unitPrice: purchaseOrderLines.unitPrice,
      gstRate: purchaseOrderLines.gstRate,
      subtotal: purchaseOrderLines.subtotal,
      taxAmount: purchaseOrderLines.taxAmount,
      total: purchaseOrderLines.total,
      itemId: items.id,
      sku: items.sku,
      name: items.name,
      unit: items.unit,
    })
    .from(purchaseOrderLines)
    .innerJoin(items, eq(items.id, purchaseOrderLines.itemId))
    .where(eq(purchaseOrderLines.orderId, orderId))
    .orderBy(asc(items.name), asc(purchaseOrderLines.id));
  return rows.map((r) => ({
    id: r.id,
    quantity: r.quantity,
    receivedQuantity: r.receivedQuantity,
    unitPrice: r.unitPrice,
    gstRate: r.gstRate,
    subtotal: r.subtotal,
    taxAmount: r.taxAmount,
    total: r.total,
    item: { id: r.itemId, sku: r.sku, name: r.name, unit: r.unit },
  }));
}

export async function insertLines(
  tx: TenantTx,
  tenantId: string,
  orderId: string,
  lines: {
    itemId: string;
    quantity: string;
    unitPrice: string;
    gstRate: number;
    subtotal: string;
    taxAmount: string;
    total: string;
  }[],
): Promise<void> {
  await tx.insert(purchaseOrderLines).values(lines.map((l) => ({ ...l, tenantId, orderId })));
}

export async function deleteLines(tx: TenantTx, orderId: string): Promise<void> {
  await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, orderId));
}

/** Lines of an order, locked, with what is still open to receive. */
export async function lockLines(tx: TenantTx, orderId: string) {
  return tx
    .select({
      id: purchaseOrderLines.id,
      itemId: purchaseOrderLines.itemId,
      quantity: purchaseOrderLines.quantity,
      receivedQuantity: purchaseOrderLines.receivedQuantity,
    })
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.orderId, orderId))
    .for('update');
}

/**
 * Adds to a line's received quantity. The WHERE clause is the guard: if the order was
 * over-received meanwhile, nothing updates and this returns false.
 */
export async function addReceived(tx: TenantTx, lineId: string, qty: string): Promise<boolean> {
  const rows = await tx
    .update(purchaseOrderLines)
    .set({ receivedQuantity: sql`${purchaseOrderLines.receivedQuantity} + ${qty}::numeric` })
    .where(
      and(
        eq(purchaseOrderLines.id, lineId),
        sql`${purchaseOrderLines.receivedQuantity} + ${qty}::numeric <= ${purchaseOrderLines.quantity}`,
      ),
    )
    .returning({ id: purchaseOrderLines.id });
  return rows.length > 0;
}

export async function countLinesStillOpen(tx: TenantTx, orderId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(purchaseOrderLines)
    .where(
      and(
        eq(purchaseOrderLines.orderId, orderId),
        sql`${purchaseOrderLines.receivedQuantity} < ${purchaseOrderLines.quantity}`,
      ),
    );
  return row!.n;
}

export async function anyReceived(tx: TenantTx, orderId: string): Promise<boolean> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(goodsReceipts)
    .where(eq(goodsReceipts.orderId, orderId));
  return row!.n > 0;
}

// ----------------------------------------------------------------- receipts

export async function insertReceipt(
  tx: TenantTx,
  values: {
    tenantId: string;
    number: string;
    orderId: string;
    warehouseId: string;
    supplierInvoiceNo: string | null;
    notes: string | null;
    receivedBy: string;
  },
): Promise<string> {
  const [row] = await tx.insert(goodsReceipts).values(values).returning({ id: goodsReceipts.id });
  return row!.id;
}

export async function insertReceiptLines(
  tx: TenantTx,
  tenantId: string,
  receiptId: string,
  lines: { orderLineId: string; itemId: string; quantity: string }[],
): Promise<void> {
  await tx.insert(goodsReceiptLines).values(lines.map((l) => ({ ...l, tenantId, receiptId })));
}

export type ReceiptRow = {
  id: string;
  number: string;
  supplierInvoiceNo: string | null;
  notes: string | null;
  createdAt: Date;
  receivedByName: string;
  warehouse: { id: string; code: string; name: string };
  lines: { quantity: string; item: { id: string; sku: string; name: string; unit: string } }[];
};

export async function listReceipts(tx: TenantTx, orderId: string): Promise<ReceiptRow[]> {
  const heads = await tx
    .select({
      id: goodsReceipts.id,
      number: goodsReceipts.number,
      supplierInvoiceNo: goodsReceipts.supplierInvoiceNo,
      notes: goodsReceipts.notes,
      createdAt: goodsReceipts.createdAt,
      receivedByName: users.fullName,
      warehouseId: warehouses.id,
      warehouseCode: warehouses.code,
      warehouseName: warehouses.name,
    })
    .from(goodsReceipts)
    .innerJoin(users, eq(users.id, goodsReceipts.receivedBy))
    .innerJoin(warehouses, eq(warehouses.id, goodsReceipts.warehouseId))
    .where(eq(goodsReceipts.orderId, orderId))
    .orderBy(desc(goodsReceipts.createdAt), desc(goodsReceipts.id));
  if (heads.length === 0) return [];
  const lines = await tx
    .select({
      receiptId: goodsReceiptLines.receiptId,
      quantity: goodsReceiptLines.quantity,
      itemId: items.id,
      sku: items.sku,
      name: items.name,
      unit: items.unit,
    })
    .from(goodsReceiptLines)
    .innerJoin(items, eq(items.id, goodsReceiptLines.itemId))
    .where(
      sql`${goodsReceiptLines.receiptId} in (${sql.join(
        heads.map((h) => sql`${h.id}`),
        sql`, `,
      )})`,
    )
    .orderBy(asc(items.name));
  return heads.map((h) => ({
    id: h.id,
    number: h.number,
    supplierInvoiceNo: h.supplierInvoiceNo,
    notes: h.notes,
    createdAt: h.createdAt,
    receivedByName: h.receivedByName,
    warehouse: { id: h.warehouseId, code: h.warehouseCode, name: h.warehouseName },
    lines: lines
      .filter((l) => l.receiptId === h.id)
      .map((l) => ({
        quantity: l.quantity,
        item: { id: l.itemId, sku: l.sku, name: l.name, unit: l.unit },
      })),
  }));
}
