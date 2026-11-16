import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { SalesOrderStatus } from '@erp/shared';
import type { TenantTx } from '../../db/client';
import {
  branches,
  deliveryLines,
  deliveries,
  items,
  salesOrderLines,
  salesOrders,
  customers,
  users,
  warehouses,
} from '../../db/schema';
import type { Scope } from '../hr/scope';
export { nextNumber } from '../purchase/purchase.repository';
import { likePattern } from '../hr/employees.repository';

// ---------------------------------------------------------------- customers

export type CustomerRow = {
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

const customerColumns = {
  id: customers.id,
  code: customers.code,
  name: customers.name,
  contactName: customers.contactName,
  email: customers.email,
  phone: customers.phone,
  gstin: customers.gstin,
  address: customers.address,
  status: customers.status,
  version: customers.version,
};

export async function listCustomers(
  tx: TenantTx,
  filter: { search?: string; status?: 'active' | 'inactive'; limit: number; offset: number },
) {
  const where = and(
    filter.search
      ? or(
          ilike(customers.name, likePattern(filter.search)),
          ilike(customers.code, likePattern(filter.search)),
          ilike(customers.gstin, likePattern(filter.search)),
        )
      : undefined,
    filter.status ? eq(customers.status, filter.status) : undefined,
  );
  const rows = await tx
    .select(customerColumns)
    .from(customers)
    .where(where)
    .orderBy(asc(customers.name), asc(customers.id))
    .limit(filter.limit)
    .offset(filter.offset);
  const [count] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(customers)
    .where(where);
  return { items: rows as CustomerRow[], total: count!.n };
}

export async function findCustomer(tx: TenantTx, id: string): Promise<CustomerRow | null> {
  const [row] = await tx
    .select(customerColumns)
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  return (row as CustomerRow | undefined) ?? null;
}

export async function insertCustomer(
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
  const [row] = await tx.insert(customers).values(values).returning({ id: customers.id });
  return row!.id;
}

/** Returns false when the version is stale. */
export async function updateCustomer(
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
    .update(customers)
    .set({ ...values, version: sql`${customers.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(customers.id, id), eq(customers.version, version)))
    .returning({ id: customers.id });
  return rows.length > 0;
}

// ------------------------------------------------------------------- orders

/** Orders belong to a branch. Branch roles see their branches' orders; "own" roles only their own. */
function orderScope(scope: Scope, userId: string): SQL | undefined {
  switch (scope.kind) {
    case 'organisation':
      return undefined;
    case 'branch':
      return scope.branchIds.length > 0
        ? sql`${salesOrders.branchId} in (${sql.join(
            scope.branchIds.map((b) => sql`${b}`),
            sql`, `,
          )})`
        : sql`false`;
    case 'own':
      return eq(salesOrders.createdBy, userId);
  }
}

const createdByUser = alias(users, 'created_by_user');
const confirmedByUser = alias(users, 'confirmed_by_user');

export type OrderRow = {
  id: string;
  number: string;
  status: SalesOrderStatus;
  orderDate: string;
  expectedDate: string | null;
  notes: string | null;
  subtotal: string;
  taxTotal: string;
  grandTotal: string;
  version: number;
  createdAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  createdBy: string;
  createdByName: string;
  confirmedBy: string | null;
  confirmedByName: string | null;
  customer: { id: string; code: string; name: string };
  branch: { id: string; code: string; name: string };
};

const orderColumns = {
  id: salesOrders.id,
  number: salesOrders.number,
  status: salesOrders.status,
  orderDate: salesOrders.orderDate,
  expectedDate: salesOrders.expectedDate,
  notes: salesOrders.notes,
  subtotal: salesOrders.subtotal,
  taxTotal: salesOrders.taxTotal,
  grandTotal: salesOrders.grandTotal,
  version: salesOrders.version,
  createdAt: salesOrders.createdAt,
  confirmedAt: salesOrders.confirmedAt,
  cancelledAt: salesOrders.cancelledAt,
  createdBy: salesOrders.createdBy,
  createdByName: createdByUser.fullName,
  confirmedBy: salesOrders.confirmedBy,
  confirmedByName: confirmedByUser.fullName,
  customerId: customers.id,
  customerCode: customers.code,
  customerName: customers.name,
  branchId: branches.id,
  branchCode: branches.code,
  branchName: branches.name,
};

const orderBase = (tx: TenantTx) =>
  tx
    .select(orderColumns)
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .innerJoin(branches, eq(branches.id, salesOrders.branchId))
    .innerJoin(createdByUser, eq(createdByUser.id, salesOrders.createdBy))
    .leftJoin(confirmedByUser, eq(confirmedByUser.id, salesOrders.confirmedBy));

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
  confirmedAt: r.confirmedAt,
  cancelledAt: r.cancelledAt,
  createdBy: r.createdBy,
  createdByName: r.createdByName,
  confirmedBy: r.confirmedBy,
  confirmedByName: r.confirmedByName,
  customer: { id: r.customerId, code: r.customerCode, name: r.customerName },
  branch: { id: r.branchId, code: r.branchCode, name: r.branchName },
});

export async function listOrders(
  tx: TenantTx,
  filter: {
    scope: Scope;
    userId: string;
    search?: string;
    status?: SalesOrderStatus;
    customerId?: string;
    limit: number;
    offset: number;
  },
) {
  const where = and(
    orderScope(filter.scope, filter.userId),
    filter.search
      ? or(
          ilike(salesOrders.number, likePattern(filter.search)),
          ilike(customers.name, likePattern(filter.search)),
        )
      : undefined,
    filter.status ? eq(salesOrders.status, filter.status) : undefined,
    filter.customerId ? eq(salesOrders.customerId, filter.customerId) : undefined,
  );
  const rows = await orderBase(tx)
    .where(where)
    .orderBy(desc(salesOrders.createdAt), desc(salesOrders.id))
    .limit(filter.limit)
    .offset(filter.offset);
  const [count] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(where);
  return { items: rows.map((r) => shapeOrder(r)), total: count!.n };
}

export async function findOrder(tx: TenantTx, id: string): Promise<OrderRow | null> {
  const [row] = await orderBase(tx).where(eq(salesOrders.id, id)).limit(1);
  return row ? shapeOrder(row) : null;
}

/** Locks the order row for the rest of the transaction, so two receipts or approvals queue up. */
export async function lockOrder(tx: TenantTx, id: string) {
  const [row] = await tx
    .select({
      id: salesOrders.id,
      status: salesOrders.status,
      version: salesOrders.version,
      branchId: salesOrders.branchId,
      createdBy: salesOrders.createdBy,
      customerId: salesOrders.customerId,
      number: salesOrders.number,
    })
    .from(salesOrders)
    .where(eq(salesOrders.id, id))
    .for('update')
    .limit(1);
  return row ?? null;
}

export async function insertOrder(
  tx: TenantTx,
  values: {
    tenantId: string;
    number: string;
    customerId: string;
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
  const [row] = await tx.insert(salesOrders).values(values).returning({ id: salesOrders.id });
  return row!.id;
}

/** Draft edit. Returns false when the version is stale or the order is no longer a draft. */
export async function updateDraftOrder(
  tx: TenantTx,
  id: string,
  version: number,
  values: {
    customerId: string;
    orderDate: string;
    expectedDate: string | null;
    notes: string | null;
    subtotal: string;
    taxTotal: string;
    grandTotal: string;
  },
): Promise<boolean> {
  const rows = await tx
    .update(salesOrders)
    .set({ ...values, version: sql`${salesOrders.version} + 1`, updatedAt: sql`now()` })
    .where(
      and(
        eq(salesOrders.id, id),
        eq(salesOrders.version, version),
        eq(salesOrders.status, 'draft'),
      ),
    )
    .returning({ id: salesOrders.id });
  return rows.length > 0;
}

export async function setOrderState(
  tx: TenantTx,
  id: string,
  values: {
    status: SalesOrderStatus;
    confirmedBy?: string;
    confirmedAt?: Date;
    cancelledAt?: Date;
  },
): Promise<void> {
  await tx
    .update(salesOrders)
    .set({ ...values, version: sql`${salesOrders.version} + 1`, updatedAt: sql`now()` })
    .where(eq(salesOrders.id, id));
}

// -------------------------------------------------------------------- lines

export type OrderLineRow = {
  id: string;
  quantity: string;
  deliveredQuantity: string;
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
      id: salesOrderLines.id,
      quantity: salesOrderLines.quantity,
      deliveredQuantity: salesOrderLines.deliveredQuantity,
      unitPrice: salesOrderLines.unitPrice,
      gstRate: salesOrderLines.gstRate,
      subtotal: salesOrderLines.subtotal,
      taxAmount: salesOrderLines.taxAmount,
      total: salesOrderLines.total,
      itemId: items.id,
      sku: items.sku,
      name: items.name,
      unit: items.unit,
    })
    .from(salesOrderLines)
    .innerJoin(items, eq(items.id, salesOrderLines.itemId))
    .where(eq(salesOrderLines.orderId, orderId))
    .orderBy(asc(items.name), asc(salesOrderLines.id));
  return rows.map((r) => ({
    id: r.id,
    quantity: r.quantity,
    deliveredQuantity: r.deliveredQuantity,
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
  await tx.insert(salesOrderLines).values(lines.map((l) => ({ ...l, tenantId, orderId })));
}

export async function deleteLines(tx: TenantTx, orderId: string): Promise<void> {
  await tx.delete(salesOrderLines).where(eq(salesOrderLines.orderId, orderId));
}

/** Lines of an order, locked, with what is still open to receive. */
export async function lockLines(tx: TenantTx, orderId: string) {
  return tx
    .select({
      id: salesOrderLines.id,
      itemId: salesOrderLines.itemId,
      quantity: salesOrderLines.quantity,
      deliveredQuantity: salesOrderLines.deliveredQuantity,
    })
    .from(salesOrderLines)
    .where(eq(salesOrderLines.orderId, orderId))
    .for('update');
}

/**
 * Adds to a line's received quantity. The WHERE clause is the guard: if the order was
 * over-received meanwhile, nothing updates and this returns false.
 */
export async function addDelivered(tx: TenantTx, lineId: string, qty: string): Promise<boolean> {
  const rows = await tx
    .update(salesOrderLines)
    .set({ deliveredQuantity: sql`${salesOrderLines.deliveredQuantity} + ${qty}::numeric` })
    .where(
      and(
        eq(salesOrderLines.id, lineId),
        sql`${salesOrderLines.deliveredQuantity} + ${qty}::numeric <= ${salesOrderLines.quantity}`,
      ),
    )
    .returning({ id: salesOrderLines.id });
  return rows.length > 0;
}

export async function countLinesStillOpen(tx: TenantTx, orderId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(salesOrderLines)
    .where(
      and(
        eq(salesOrderLines.orderId, orderId),
        sql`${salesOrderLines.deliveredQuantity} < ${salesOrderLines.quantity}`,
      ),
    );
  return row!.n;
}

export async function anyDelivered(tx: TenantTx, orderId: string): Promise<boolean> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(deliveries)
    .where(eq(deliveries.orderId, orderId));
  return row!.n > 0;
}

// ----------------------------------------------------------------- receipts

export async function insertDelivery(
  tx: TenantTx,
  values: {
    tenantId: string;
    number: string;
    orderId: string;
    warehouseId: string;
    reference: string | null;
    notes: string | null;
    deliveredBy: string;
  },
): Promise<string> {
  const [row] = await tx.insert(deliveries).values(values).returning({ id: deliveries.id });
  return row!.id;
}

export async function insertDeliveryLines(
  tx: TenantTx,
  tenantId: string,
  deliveryId: string,
  lines: { orderLineId: string; itemId: string; quantity: string }[],
): Promise<void> {
  await tx.insert(deliveryLines).values(lines.map((l) => ({ ...l, tenantId, deliveryId })));
}

export type DeliveryRow = {
  id: string;
  number: string;
  reference: string | null;
  notes: string | null;
  createdAt: Date;
  deliveredByName: string;
  warehouse: { id: string; code: string; name: string };
  lines: { quantity: string; item: { id: string; sku: string; name: string; unit: string } }[];
};

export async function listDeliveries(tx: TenantTx, orderId: string): Promise<DeliveryRow[]> {
  const heads = await tx
    .select({
      id: deliveries.id,
      number: deliveries.number,
      reference: deliveries.reference,
      notes: deliveries.notes,
      createdAt: deliveries.createdAt,
      deliveredByName: users.fullName,
      warehouseId: warehouses.id,
      warehouseCode: warehouses.code,
      warehouseName: warehouses.name,
    })
    .from(deliveries)
    .innerJoin(users, eq(users.id, deliveries.deliveredBy))
    .innerJoin(warehouses, eq(warehouses.id, deliveries.warehouseId))
    .where(eq(deliveries.orderId, orderId))
    .orderBy(desc(deliveries.createdAt), desc(deliveries.id));
  if (heads.length === 0) return [];
  const lines = await tx
    .select({
      deliveryId: deliveryLines.deliveryId,
      quantity: deliveryLines.quantity,
      itemId: items.id,
      sku: items.sku,
      name: items.name,
      unit: items.unit,
    })
    .from(deliveryLines)
    .innerJoin(items, eq(items.id, deliveryLines.itemId))
    .where(
      sql`${deliveryLines.deliveryId} in (${sql.join(
        heads.map((h) => sql`${h.id}`),
        sql`, `,
      )})`,
    )
    .orderBy(asc(items.name));
  return heads.map((h) => ({
    id: h.id,
    number: h.number,
    reference: h.reference,
    notes: h.notes,
    createdAt: h.createdAt,
    deliveredByName: h.deliveredByName,
    warehouse: { id: h.warehouseId, code: h.warehouseCode, name: h.warehouseName },
    lines: lines
      .filter((l) => l.deliveryId === h.id)
      .map((l) => ({
        quantity: l.quantity,
        item: { id: l.itemId, sku: l.sku, name: l.name, unit: l.unit },
      })),
  }));
}
