import { and, asc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { MovementKind } from '@erp/shared';
import type { TenantTx } from '../../db/client';
import { branches, items, stockBalances, stockMovements, users, warehouses } from '../../db/schema';
import type { Scope } from '../hr/scope';
import { likePattern } from '../hr/employees.repository';

// ------------------------------------------------------------------- scope

/**
 * Warehouses belong to a branch, so a branch-scoped role sees only its branches' warehouses.
 * An "own"-scoped role (a plain employee) has no business in the store at all.
 */
function warehouseScope(
  scope: Scope,
  column: SQL | typeof warehouses.branchId = warehouses.branchId,
): SQL | undefined {
  switch (scope.kind) {
    case 'organisation':
      return undefined;
    case 'branch':
      return scope.branchIds.length > 0
        ? sql`${column} in (${sql.join(
            scope.branchIds.map((b) => sql`${b}`),
            sql`, `,
          )})`
        : sql`false`;
    case 'own':
      return sql`false`;
  }
}

// ------------------------------------------------------------------- items

export type ItemRow = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  category: string | null;
  reorderLevel: string;
  status: 'active' | 'inactive';
  version: number;
};

const itemColumns = {
  id: items.id,
  sku: items.sku,
  name: items.name,
  unit: items.unit,
  category: items.category,
  reorderLevel: items.reorderLevel,
  status: items.status,
  version: items.version,
};

export async function listItems(
  tx: TenantTx,
  filter: { search?: string; status?: 'active' | 'inactive'; limit: number; offset: number },
) {
  const where = and(
    filter.search
      ? or(
          ilike(items.name, likePattern(filter.search)),
          ilike(items.sku, likePattern(filter.search)),
          ilike(items.category, likePattern(filter.search)),
        )
      : undefined,
    filter.status ? eq(items.status, filter.status) : undefined,
  );
  const rows = await tx
    .select(itemColumns)
    .from(items)
    .where(where)
    .orderBy(asc(items.name), asc(items.id))
    .limit(filter.limit)
    .offset(filter.offset);
  const [count] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(items)
    .where(where);
  return { items: rows, total: count!.n };
}

export async function findItem(tx: TenantTx, id: string): Promise<ItemRow | null> {
  const [row] = await tx.select(itemColumns).from(items).where(eq(items.id, id)).limit(1);
  return row ?? null;
}

export async function insertItem(
  tx: TenantTx,
  values: {
    tenantId: string;
    sku: string;
    name: string;
    unit: string;
    category: string | null;
    reorderLevel: string;
  },
): Promise<string> {
  const [row] = await tx.insert(items).values(values).returning({ id: items.id });
  return row!.id;
}

/** Returns false when the version is stale. */
export async function updateItem(
  tx: TenantTx,
  id: string,
  version: number,
  values: {
    name: string;
    category: string | null;
    reorderLevel: string;
    status: 'active' | 'inactive';
  },
): Promise<boolean> {
  const rows = await tx
    .update(items)
    .set({ ...values, version: sql`${items.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(items.id, id), eq(items.version, version)))
    .returning({ id: items.id });
  return rows.length > 0;
}

// -------------------------------------------------------------- warehouses

export type WarehouseRow = {
  id: string;
  code: string;
  name: string;
  status: 'active' | 'inactive';
  version: number;
  branchId: string;
  branch: { id: string; code: string; name: string };
};

const warehouseColumns = {
  id: warehouses.id,
  code: warehouses.code,
  name: warehouses.name,
  status: warehouses.status,
  version: warehouses.version,
  branchId: warehouses.branchId,
  branchCode: branches.code,
  branchName: branches.name,
};

const shapeWarehouse = (r: {
  id: string;
  code: string;
  name: string;
  status: 'active' | 'inactive';
  version: number;
  branchId: string;
  branchCode: string;
  branchName: string;
}): WarehouseRow => ({
  id: r.id,
  code: r.code,
  name: r.name,
  status: r.status,
  version: r.version,
  branchId: r.branchId,
  branch: { id: r.branchId, code: r.branchCode, name: r.branchName },
});

const warehouseBase = (tx: TenantTx) =>
  tx
    .select(warehouseColumns)
    .from(warehouses)
    .innerJoin(branches, eq(branches.id, warehouses.branchId));

export async function listWarehouses(
  tx: TenantTx,
  filter: { scope: Scope; branchId?: string; status?: 'active' | 'inactive' },
): Promise<WarehouseRow[]> {
  const rows = await warehouseBase(tx)
    .where(
      and(
        warehouseScope(filter.scope),
        filter.branchId ? eq(warehouses.branchId, filter.branchId) : undefined,
        filter.status ? eq(warehouses.status, filter.status) : undefined,
      ),
    )
    .orderBy(asc(warehouses.name), asc(warehouses.id));
  return rows.map(shapeWarehouse);
}

export async function findWarehouse(tx: TenantTx, id: string): Promise<WarehouseRow | null> {
  const [row] = await warehouseBase(tx).where(eq(warehouses.id, id)).limit(1);
  return row ? shapeWarehouse(row) : null;
}

export async function countWarehouses(tx: TenantTx): Promise<number> {
  const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(warehouses);
  return row!.n;
}

export async function findBranch(tx: TenantTx, id: string) {
  const [row] = await tx
    .select({ id: branches.id, status: branches.status, isHeadOffice: branches.isHeadOffice })
    .from(branches)
    .where(eq(branches.id, id))
    .limit(1);
  return row ?? null;
}

export async function findHeadOffice(tx: TenantTx) {
  const [row] = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(eq(branches.isHeadOffice, true))
    .limit(1);
  return row ?? null;
}

export async function insertWarehouse(
  tx: TenantTx,
  values: { tenantId: string; code: string; name: string; branchId: string },
): Promise<string> {
  const [row] = await tx.insert(warehouses).values(values).returning({ id: warehouses.id });
  return row!.id;
}

export async function updateWarehouse(
  tx: TenantTx,
  id: string,
  version: number,
  values: { name: string; status: 'active' | 'inactive' },
): Promise<boolean> {
  const rows = await tx
    .update(warehouses)
    .set({ ...values, version: sql`${warehouses.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(warehouses.id, id), eq(warehouses.version, version)))
    .returning({ id: warehouses.id });
  return rows.length > 0;
}

// ------------------------------------------------------------------- stock

/**
 * Adds `delta` (a decimal string, negative to remove) to one item's stock in one warehouse and
 * writes the ledger row, in the caller's transaction.
 *
 * The balance changes in a single UPDATE that refuses to go below zero, so two people issuing
 * the last units at the same moment cannot both succeed: the second waits on the row lock,
 * then finds too little left. Returns the new balance, or null when there was not enough stock.
 */
export async function applyMovement(
  tx: TenantTx,
  m: {
    tenantId: string;
    itemId: string;
    warehouseId: string;
    kind: MovementKind;
    delta: string;
    transferId?: string;
    reference: string | null;
    reason: string | null;
    createdBy: string;
  },
): Promise<string | null> {
  await tx
    .insert(stockBalances)
    .values({ tenantId: m.tenantId, itemId: m.itemId, warehouseId: m.warehouseId })
    .onConflictDoNothing();

  const [updated] = await tx
    .update(stockBalances)
    .set({
      quantity: sql`${stockBalances.quantity} + ${m.delta}::numeric`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(stockBalances.itemId, m.itemId),
        eq(stockBalances.warehouseId, m.warehouseId),
        sql`${stockBalances.quantity} + ${m.delta}::numeric >= 0`,
      ),
    )
    .returning({ quantity: stockBalances.quantity });
  if (!updated) return null;

  await tx.insert(stockMovements).values({
    tenantId: m.tenantId,
    itemId: m.itemId,
    warehouseId: m.warehouseId,
    kind: m.kind,
    quantity: m.delta,
    balanceAfter: updated.quantity,
    transferId: m.transferId ?? null,
    reference: m.reference,
    reason: m.reason,
    createdBy: m.createdBy,
  });
  return updated.quantity;
}

export type StockSummaryRow = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  status: 'active' | 'inactive';
  reorderLevel: string;
  onHand: string;
  low: boolean;
};

/** Per-item totals across the warehouses the viewer may see (or just one of them). */
export async function stockSummary(
  tx: TenantTx,
  filter: {
    scope: Scope;
    search?: string;
    warehouseId?: string;
    lowOnly: boolean;
    limit: number;
    offset: number;
  },
): Promise<{ items: StockSummaryRow[]; total: number }> {
  const scope = warehouseScope(filter.scope, sql`w.branch_id`) ?? sql`true`;
  const warehouse = filter.warehouseId ? sql`and w.id = ${filter.warehouseId}` : sql``;
  const search = filter.search
    ? sql`and (i.name ilike ${likePattern(filter.search)} or i.sku ilike ${likePattern(filter.search)})`
    : sql``;
  const low = filter.lowOnly ? sql`where t.low` : sql``;

  const grouped = sql`
    select i.id, i.sku, i.name, i.unit, i.status, i.reorder_level,
           coalesce(sum(b.quantity) filter (where w.id is not null), 0)::numeric(14,3) as on_hand
    from items i
    left join stock_balances b on b.item_id = i.id
    left join warehouses w on w.id = b.warehouse_id and ${scope} ${warehouse}
    where true ${search}
    group by i.id
  `;
  const flagged = sql`
    select g.*, (g.reorder_level > 0 and g.on_hand <= g.reorder_level) as low from (${grouped}) g
  `;

  const rows = await tx.execute<{
    id: string;
    sku: string;
    name: string;
    unit: string;
    status: 'active' | 'inactive';
    reorder_level: string;
    on_hand: string;
    low: boolean;
  }>(sql`
    select * from (${flagged}) t ${low}
    order by t.name asc, t.id asc
    limit ${filter.limit} offset ${filter.offset}
  `);
  const count = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from (${flagged}) t ${low}`,
  );
  return {
    items: [...rows].map((r) => ({
      id: r.id,
      sku: r.sku,
      name: r.name,
      unit: r.unit,
      status: r.status,
      reorderLevel: r.reorder_level,
      onHand: r.on_hand,
      low: r.low,
    })),
    total: [...count][0]?.n ?? 0,
  };
}

export type BalanceRow = {
  itemId: string;
  quantity: string;
  warehouse: { id: string; code: string; name: string };
};

/** Where an item's stock sits, for the warehouses the viewer may see. Empty balances are left out. */
export async function balancesForItems(
  tx: TenantTx,
  itemIds: string[],
  scope: Scope,
  warehouseId?: string,
): Promise<BalanceRow[]> {
  if (itemIds.length === 0) return [];
  const rows = await tx
    .select({
      itemId: stockBalances.itemId,
      quantity: stockBalances.quantity,
      warehouseId: warehouses.id,
      code: warehouses.code,
      name: warehouses.name,
    })
    .from(stockBalances)
    .innerJoin(warehouses, eq(warehouses.id, stockBalances.warehouseId))
    .where(
      and(
        sql`${stockBalances.itemId} in (${sql.join(
          itemIds.map((i) => sql`${i}`),
          sql`, `,
        )})`,
        sql`${stockBalances.quantity} > 0`,
        warehouseScope(scope),
        warehouseId ? eq(warehouses.id, warehouseId) : undefined,
      ),
    )
    .orderBy(asc(warehouses.name));
  return rows.map((r) => ({
    itemId: r.itemId,
    quantity: r.quantity,
    warehouse: { id: r.warehouseId, code: r.code, name: r.name },
  }));
}

export type MovementRow = {
  id: string;
  kind: MovementKind;
  quantity: string;
  balanceAfter: string;
  reference: string | null;
  reason: string | null;
  createdAt: Date;
  transferId: string | null;
  item: { id: string; sku: string; name: string; unit: string };
  warehouse: { id: string; code: string; name: string };
  createdByName: string;
};

export async function listMovements(
  tx: TenantTx,
  filter: {
    scope: Scope;
    itemId?: string;
    warehouseId?: string;
    kind?: MovementKind;
    limit: number;
    offset: number;
  },
) {
  const where = and(
    warehouseScope(filter.scope),
    filter.itemId ? eq(stockMovements.itemId, filter.itemId) : undefined,
    filter.warehouseId ? eq(stockMovements.warehouseId, filter.warehouseId) : undefined,
    filter.kind ? eq(stockMovements.kind, filter.kind) : undefined,
  );
  const rows = await tx
    .select({
      id: stockMovements.id,
      kind: stockMovements.kind,
      quantity: stockMovements.quantity,
      balanceAfter: stockMovements.balanceAfter,
      reference: stockMovements.reference,
      reason: stockMovements.reason,
      createdAt: stockMovements.createdAt,
      transferId: stockMovements.transferId,
      itemId: items.id,
      sku: items.sku,
      itemName: items.name,
      unit: items.unit,
      warehouseId: warehouses.id,
      warehouseCode: warehouses.code,
      warehouseName: warehouses.name,
      createdByName: users.fullName,
    })
    .from(stockMovements)
    .innerJoin(items, eq(items.id, stockMovements.itemId))
    .innerJoin(warehouses, eq(warehouses.id, stockMovements.warehouseId))
    .innerJoin(users, eq(users.id, stockMovements.createdBy))
    .where(where)
    .orderBy(sql`${stockMovements.createdAt} desc`, sql`${stockMovements.id} desc`)
    .limit(filter.limit)
    .offset(filter.offset);
  const [count] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(stockMovements)
    .innerJoin(warehouses, eq(warehouses.id, stockMovements.warehouseId))
    .where(where);
  return {
    items: rows.map((r): MovementRow => ({
      id: r.id,
      kind: r.kind,
      quantity: r.quantity,
      balanceAfter: r.balanceAfter,
      reference: r.reference,
      reason: r.reason,
      createdAt: r.createdAt,
      transferId: r.transferId,
      item: { id: r.itemId, sku: r.sku, name: r.itemName, unit: r.unit },
      warehouse: { id: r.warehouseId, code: r.warehouseCode, name: r.warehouseName },
      createdByName: r.createdByName,
    })),
    total: count!.n,
  };
}

/** The quantity in one warehouse right now, for error messages ("only 3 left"). */
export async function currentBalance(
  tx: TenantTx,
  itemId: string,
  warehouseId: string,
): Promise<string> {
  const [row] = await tx
    .select({ quantity: stockBalances.quantity })
    .from(stockBalances)
    .where(and(eq(stockBalances.itemId, itemId), eq(stockBalances.warehouseId, warehouseId)))
    .limit(1);
  return row?.quantity ?? '0.000';
}
