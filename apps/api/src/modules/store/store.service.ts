import { randomUUID } from 'node:crypto';
import {
  adjustStockInputSchema,
  createItemInputSchema,
  createWarehouseInputSchema,
  issueStockInputSchema,
  listItemsInputSchema,
  listWarehousesInputSchema,
  movementsInputSchema,
  receiveStockInputSchema,
  stockLevelsInputSchema,
  transferStockInputSchema,
  updateItemInputSchema,
  updateWarehouseInputSchema,
  type MovementKind,
  type Viewer,
} from '@erp/shared';
import { requirePermission } from '../../core/auth/guard';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../core/errors';
import { parseId } from '../../core/errors/parse-id';
import type { Logger } from '../../core/logger';
import type { Database, TenantTx } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import { withTenant } from '../../db/tenant';
import { assertBranchInScope, inScope, scopeOf } from '../hr/scope';
import { ensureStoreDefaults } from './defaults.repository';
import * as repo from './store.repository';

const STALE = 'Someone else changed this record. Reload it and try again.';

export interface StoreDeps {
  db: Database;
  logger: Logger;
}

export function createStoreService({ db, logger }: StoreDeps) {
  const run = <T>(viewer: Viewer, fn: (tx: TenantTx, tenantId: string) => Promise<T>) =>
    withTenant(db, viewer.organisation.id, (tx) => fn(tx, viewer.organisation.id));

  const audit = (viewer: Viewer, action: string, target: Record<string, unknown>) =>
    logger.info(
      { audit: true, actor: viewer.user.id, tenantId: viewer.organisation.id, action, ...target },
      'store action',
    );

  /** A warehouse outside the viewer's scope looks exactly like a missing one. */
  async function visibleWarehouse(tx: TenantTx, viewer: Viewer, id: string, field: string) {
    const warehouse = await repo.findWarehouse(tx, id);
    if (!warehouse || !inScope(viewer, { branchId: warehouse.branchId, userId: null })) {
      throw new NotFoundError('Warehouse not found');
    }
    if (warehouse.status !== 'active') {
      throw new ValidationError({ [field]: ['This warehouse is inactive'] });
    }
    return warehouse;
  }

  async function activeItem(tx: TenantTx, id: string) {
    const item = await repo.findItem(tx, id);
    if (!item) throw new NotFoundError('Item not found');
    if (item.status !== 'active') {
      throw new ValidationError({ itemId: ['This item is inactive'] });
    }
    return item;
  }

  async function notEnough(tx: TenantTx, itemId: string, warehouseId: string): Promise<never> {
    const left = await repo.currentBalance(tx, itemId, warehouseId);
    const message = `Not enough stock: only ${Number(left)} on hand in this warehouse`;
    throw new BusinessRuleError(message, { fieldErrors: { quantity: [message] } });
  }

  /** Receipts, issues and adjustments: one signed change to one warehouse. */
  async function single(
    viewer: Viewer,
    kind: MovementKind,
    input: {
      itemId: string;
      warehouseId: string;
      delta: string;
      reference: string | null;
      reason: string | null;
    },
  ) {
    const balance = await run(viewer, async (tx, tenantId) => {
      await activeItem(tx, input.itemId);
      await visibleWarehouse(tx, viewer, input.warehouseId, 'warehouseId');
      const result = await repo.applyMovement(tx, {
        tenantId,
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        kind,
        delta: input.delta,
        reference: input.reference,
        reason: input.reason,
        createdBy: viewer.user.id,
      });
      if (result === null) return notEnough(tx, input.itemId, input.warehouseId);
      return result;
    });
    audit(viewer, `stock.${kind}`, {
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      delta: input.delta,
    });
    return { itemId: input.itemId, warehouseId: input.warehouseId, balance };
  }

  const mapConflict = (error: unknown, what: string, field: string): never => {
    if (isUniqueViolation(error)) {
      const message = `${what} already exists`;
      throw new ConflictError(message, { fieldErrors: { [field]: [message] } });
    }
    throw error;
  };

  return {
    // ------------------------------------------------------------------ items

    async listItems(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'store.item.view');
      const input = listItemsInputSchema.parse(raw ?? {});
      return run(viewer, (tx) => repo.listItems(tx, input));
    },

    async getItem(viewer: Viewer, rawId: unknown) {
      requirePermission(viewer, 'store.item.view');
      const id = parseId(rawId);
      const item = await run(viewer, (tx) => repo.findItem(tx, id));
      if (!item) throw new NotFoundError('Item not found');
      return item;
    },

    async createItem(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'store.item.create');
      const input = createItemInputSchema.parse(raw);
      try {
        const id = await run(viewer, (tx, tenantId) => repo.insertItem(tx, { ...input, tenantId }));
        audit(viewer, 'item.create', { itemId: id });
        return (await run(viewer, (tx) => repo.findItem(tx, id)))!;
      } catch (error) {
        return mapConflict(error, 'An item with this SKU', 'sku');
      }
    },

    async updateItem(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'store.item.update');
      const id = parseId(rawId);
      const { version, ...values } = updateItemInputSchema.parse(raw);
      await run(viewer, async (tx) => {
        if (!(await repo.findItem(tx, id))) throw new NotFoundError('Item not found');
        if (!(await repo.updateItem(tx, id, version, values))) throw new ConflictError(STALE);
      });
      audit(viewer, 'item.update', { itemId: id });
      return (await run(viewer, (tx) => repo.findItem(tx, id)))!;
    },

    // ------------------------------------------------------------- warehouses

    async listWarehouses(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'store.warehouse.view');
      const input = listWarehousesInputSchema.parse(raw ?? {});
      return run(viewer, async (tx, tenantId) => {
        await ensureStoreDefaults(tx, tenantId);
        return repo.listWarehouses(tx, { ...input, scope: scopeOf(viewer) });
      });
    },

    async createWarehouse(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'store.warehouse.manage');
      const input = createWarehouseInputSchema.parse(raw);
      assertBranchInScope(viewer, input.branchId);
      try {
        const id = await run(viewer, async (tx, tenantId) => {
          const branch = await repo.findBranch(tx, input.branchId);
          if (!branch) throw new ValidationError({ branchId: ['Choose a branch'] });
          if (branch.status !== 'active') {
            throw new ValidationError({ branchId: ['Choose an active branch'] });
          }
          return repo.insertWarehouse(tx, { ...input, tenantId });
        });
        audit(viewer, 'warehouse.create', { warehouseId: id });
        return (await run(viewer, (tx) => repo.findWarehouse(tx, id)))!;
      } catch (error) {
        return mapConflict(error, 'A warehouse with this code', 'code');
      }
    },

    async updateWarehouse(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'store.warehouse.manage');
      const id = parseId(rawId);
      const { version, ...values } = updateWarehouseInputSchema.parse(raw);
      await run(viewer, async (tx) => {
        const current = await repo.findWarehouse(tx, id);
        if (!current || !inScope(viewer, { branchId: current.branchId, userId: null })) {
          throw new NotFoundError('Warehouse not found');
        }
        if (!(await repo.updateWarehouse(tx, id, version, values))) {
          throw new ConflictError(STALE);
        }
      });
      audit(viewer, 'warehouse.update', { warehouseId: id });
      return (await run(viewer, (tx) => repo.findWarehouse(tx, id)))!;
    },

    // ------------------------------------------------------------------ stock

    receive(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'store.stock.receive');
      const { quantity, ...rest } = receiveStockInputSchema.parse(raw);
      return single(viewer, 'receipt', { ...rest, delta: quantity });
    },

    issue(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'store.stock.issue');
      const { quantity, ...rest } = issueStockInputSchema.parse(raw);
      return single(viewer, 'issue', { ...rest, delta: `-${quantity}` });
    },

    adjust(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'store.stock.adjust');
      const { quantity, reason, ...rest } = adjustStockInputSchema.parse(raw);
      return single(viewer, 'adjustment', { ...rest, delta: quantity, reason, reference: null });
    },

    async transfer(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'store.stock.transfer');
      const input = transferStockInputSchema.parse(raw);
      const transferId = randomUUID();
      const result = await run(viewer, async (tx, tenantId) => {
        await activeItem(tx, input.itemId);
        await visibleWarehouse(tx, viewer, input.fromWarehouseId, 'fromWarehouseId');
        await visibleWarehouse(tx, viewer, input.toWarehouseId, 'toWarehouseId');
        const leg = (warehouseId: string, kind: MovementKind, delta: string) =>
          repo.applyMovement(tx, {
            tenantId,
            itemId: input.itemId,
            warehouseId,
            kind,
            delta,
            transferId,
            reference: input.reference,
            reason: input.reason,
            createdBy: viewer.user.id,
          });
        // Always touch the lower warehouse id first. Two opposite transfers running at once then
        // queue on the same row instead of each holding one and waiting for the other.
        const outFirst = input.fromWarehouseId < input.toWarehouseId;
        let from: string | null;
        let to: string | null;
        if (outFirst) {
          from = await leg(input.fromWarehouseId, 'transfer_out', `-${input.quantity}`);
          to = await leg(input.toWarehouseId, 'transfer_in', input.quantity);
        } else {
          to = await leg(input.toWarehouseId, 'transfer_in', input.quantity);
          from = await leg(input.fromWarehouseId, 'transfer_out', `-${input.quantity}`);
        }
        if (from === null) return notEnough(tx, input.itemId, input.fromWarehouseId);
        return { from, to: to! };
      });
      audit(viewer, 'stock.transfer', {
        itemId: input.itemId,
        from: input.fromWarehouseId,
        to: input.toWarehouseId,
        quantity: input.quantity,
        transferId,
      });
      return {
        itemId: input.itemId,
        transferId,
        fromBalance: result.from,
        toBalance: result.to,
      };
    },

    // ---------------------------------------------------------------- reports

    async stockLevels(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'store.stock.view');
      const input = stockLevelsInputSchema.parse(raw ?? {});
      return run(viewer, async (tx) => {
        const scope = scopeOf(viewer);
        if (input.warehouseId) {
          const w = await repo.findWarehouse(tx, input.warehouseId);
          if (!w || !inScope(viewer, { branchId: w.branchId, userId: null })) {
            throw new NotFoundError('Warehouse not found');
          }
        }
        const page = await repo.stockSummary(tx, { ...input, scope });
        const balances = await repo.balancesForItems(
          tx,
          page.items.map((i) => i.id),
          scope,
          input.warehouseId,
        );
        return {
          total: page.total,
          items: page.items.map((i) => ({
            ...i,
            byWarehouse: balances
              .filter((b) => b.itemId === i.id)
              .map((b) => ({ warehouse: b.warehouse, quantity: b.quantity })),
          })),
        };
      });
    },

    async movements(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'store.stock.view');
      const input = movementsInputSchema.parse(raw ?? {});
      return run(viewer, (tx) => repo.listMovements(tx, { ...input, scope: scopeOf(viewer) }));
    },
  };
}

export type StoreService = ReturnType<typeof createStoreService>;
