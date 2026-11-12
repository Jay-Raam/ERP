import {
  hasPermission,
  MAX_STOCK,
  createOrderInputSchema,
  createSupplierInputSchema,
  lineAmounts,
  listOrdersInputSchema,
  listSuppliersInputSchema,
  orderAmounts,
  orderDecisionInputSchema,
  paiseToString,
  receiveGoodsInputSchema,
  updateOrderInputSchema,
  updateSupplierInputSchema,
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
import { enforceLimit, type Limits, type RateLimiter } from '../../core/rate-limit';
import type { Database, TenantTx } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import { withTenant } from '../../db/tenant';
import { assertBranchInScope, inScope, scopeOf } from '../hr/scope';
import * as storeRepo from '../store/store.repository';
import * as repo from './purchase.repository';

const STALE = 'Someone else changed this record. Reload it and try again.';

export interface PurchaseDeps {
  db: Database;
  logger: Logger;
  limiter: RateLimiter;
  limits: Limits;
}

type DraftLine = { itemId: string; quantity: string; unitPrice: string; gstRate: number };

/** Amounts for every line and the order, worked out here; nothing the client sends is trusted. */
function priceLines(lines: DraftLine[]) {
  const amounts = lines.map((l) => ({
    line: l,
    ...lineAmounts(l.quantity, l.unitPrice, l.gstRate),
  }));
  const totals = orderAmounts(amounts);
  return {
    totals,
    lines: amounts.map((a) => ({
      itemId: a.line.itemId,
      quantity: a.line.quantity,
      unitPrice: a.line.unitPrice,
      gstRate: a.line.gstRate,
      subtotal: paiseToString(a.subtotal),
      taxAmount: paiseToString(a.tax),
      total: paiseToString(a.total),
    })),
  };
}

export function createPurchaseService({ db, logger, limiter, limits }: PurchaseDeps) {
  const run = <T>(viewer: Viewer, fn: (tx: TenantTx, tenantId: string) => Promise<T>) =>
    withTenant(db, viewer.organisation.id, (tx) => fn(tx, viewer.organisation.id));

  const audit = (viewer: Viewer, action: string, target: Record<string, unknown>) =>
    logger.info(
      { audit: true, actor: viewer.user.id, tenantId: viewer.organisation.id, action, ...target },
      'purchase action',
    );

  const mapConflict = (error: unknown, what: string, field: string): never => {
    if (isUniqueViolation(error)) {
      const message = `${what} already exists`;
      throw new ConflictError(message, { fieldErrors: { [field]: [message] } });
    }
    throw error;
  };

  /** An order outside the viewer's scope looks exactly like a missing one. */
  const visible = (viewer: Viewer, order: { branchId: string; createdBy: string }) =>
    inScope(viewer, { branchId: order.branchId, userId: order.createdBy });

  async function activeSupplier(tx: TenantTx, id: string) {
    const supplier = await repo.findSupplier(tx, id);
    if (!supplier) throw new ValidationError({ supplierId: ['Choose a supplier'] });
    if (supplier.status !== 'active') {
      throw new ValidationError({ supplierId: ['This supplier is inactive'] });
    }
    return supplier;
  }

  async function activeItems(tx: TenantTx, lines: DraftLine[]) {
    for (const [index, line] of lines.entries()) {
      const item = await storeRepo.findItem(tx, line.itemId);
      if (!item) throw new ValidationError({ [`lines.${index}.itemId`]: ['Choose an item'] });
      if (item.status !== 'active') {
        throw new ValidationError({ [`lines.${index}.itemId`]: ['This item is inactive'] });
      }
    }
  }

  async function detail(viewer: Viewer, tx: TenantTx, id: string) {
    const order = await repo.findOrder(tx, id);
    if (!order || !visible(viewer, { branchId: order.branch.id, createdBy: order.createdBy })) {
      throw new NotFoundError('Purchase order not found');
    }
    const canSeeReceipts = hasPermission(viewer.permissions, 'purchase.receipt.view');
    return {
      ...order,
      lines: await repo.listLines(tx, id),
      receipts: canSeeReceipts ? await repo.listReceipts(tx, id) : [],
    };
  }

  const limitWrites = (viewer: Viewer) =>
    enforceLimit(
      limiter,
      `stock:user:${viewer.user.id}`,
      limits.stockWritesPerUser,
      'You are changing stock too quickly.',
    );

  /** Loads and locks an order the viewer may act on, or throws the same error for both cases. */
  async function lockVisible(tx: TenantTx, viewer: Viewer, id: string) {
    const order = await repo.lockOrder(tx, id);
    if (!order || !visible(viewer, order)) throw new NotFoundError('Purchase order not found');
    return order;
  }

  return {
    // -------------------------------------------------------------- suppliers

    async listSuppliers(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'purchase.supplier.view');
      const input = listSuppliersInputSchema.parse(raw ?? {});
      return run(viewer, (tx) => repo.listSuppliers(tx, input));
    },

    async getSupplier(viewer: Viewer, rawId: unknown) {
      requirePermission(viewer, 'purchase.supplier.view');
      const id = parseId(rawId);
      const supplier = await run(viewer, (tx) => repo.findSupplier(tx, id));
      if (!supplier) throw new NotFoundError('Supplier not found');
      return supplier;
    },

    async createSupplier(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'purchase.supplier.create');
      const input = createSupplierInputSchema.parse(raw);
      try {
        const id = await run(viewer, (tx, tenantId) =>
          repo.insertSupplier(tx, { ...input, tenantId }),
        );
        audit(viewer, 'supplier.create', { supplierId: id });
        return (await run(viewer, (tx) => repo.findSupplier(tx, id)))!;
      } catch (error) {
        return mapConflict(error, 'A supplier with this code', 'code');
      }
    },

    async updateSupplier(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'purchase.supplier.update');
      const id = parseId(rawId);
      const { version, ...values } = updateSupplierInputSchema.parse(raw);
      await run(viewer, async (tx) => {
        if (!(await repo.findSupplier(tx, id))) throw new NotFoundError('Supplier not found');
        if (!(await repo.updateSupplier(tx, id, version, values))) throw new ConflictError(STALE);
      });
      audit(viewer, 'supplier.update', { supplierId: id });
      return (await run(viewer, (tx) => repo.findSupplier(tx, id)))!;
    },

    // ----------------------------------------------------------------- orders

    async listOrders(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'purchase.order.view');
      const input = listOrdersInputSchema.parse(raw ?? {});
      return run(viewer, (tx) =>
        repo.listOrders(tx, { ...input, scope: scopeOf(viewer), userId: viewer.user.id }),
      );
    },

    async getOrder(viewer: Viewer, rawId: unknown) {
      requirePermission(viewer, 'purchase.order.view');
      const id = parseId(rawId);
      return run(viewer, (tx) => detail(viewer, tx, id));
    },

    async createOrder(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'purchase.order.create');
      const { lines, branchId, ...head } = createOrderInputSchema.parse(raw);
      assertBranchInScope(viewer, branchId);
      const priced = priceLines(lines);
      const id = await run(viewer, async (tx, tenantId) => {
        await activeSupplier(tx, head.supplierId);
        const branch = await storeRepo.findBranch(tx, branchId);
        if (!branch) throw new ValidationError({ branchId: ['Choose a branch'] });
        if (branch.status !== 'active') {
          throw new ValidationError({ branchId: ['Choose an active branch'] });
        }
        await activeItems(tx, lines);
        const orderId = await repo.insertOrder(tx, {
          ...head,
          tenantId,
          branchId,
          number: await repo.nextNumber(tx, tenantId, 'PO'),
          subtotal: priced.totals.subtotal,
          taxTotal: priced.totals.tax,
          grandTotal: priced.totals.total,
          createdBy: viewer.user.id,
        });
        await repo.insertLines(tx, tenantId, orderId, priced.lines);
        return orderId;
      });
      audit(viewer, 'order.create', { orderId: id });
      return run(viewer, (tx) => detail(viewer, tx, id));
    },

    async updateOrder(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'purchase.order.create');
      const id = parseId(rawId);
      const { version, lines, ...head } = updateOrderInputSchema.parse(raw);
      const priced = priceLines(lines);
      await run(viewer, async (tx, tenantId) => {
        const order = await lockVisible(tx, viewer, id);
        if (order.status !== 'draft') {
          throw new BusinessRuleError('Only a draft order can be edited');
        }
        await activeSupplier(tx, head.supplierId);
        await activeItems(tx, lines);
        const ok = await repo.updateDraftOrder(tx, id, version, {
          ...head,
          subtotal: priced.totals.subtotal,
          taxTotal: priced.totals.tax,
          grandTotal: priced.totals.total,
        });
        if (!ok) throw new ConflictError(STALE);
        await repo.deleteLines(tx, id);
        await repo.insertLines(tx, tenantId, id, priced.lines);
      });
      audit(viewer, 'order.update', { orderId: id });
      return run(viewer, (tx) => detail(viewer, tx, id));
    },

    async approveOrder(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'purchase.order.approve');
      const id = parseId(rawId);
      const { version } = orderDecisionInputSchema.parse(raw);
      await run(viewer, async (tx) => {
        const order = await lockVisible(tx, viewer, id);
        if (order.version !== version) throw new ConflictError(STALE);
        if (order.status !== 'draft') {
          throw new BusinessRuleError('Only a draft order can be approved');
        }
        if (order.createdBy === viewer.user.id) {
          throw new BusinessRuleError('You cannot approve an order you created');
        }
        await activeSupplier(tx, order.supplierId);
        const lines = await repo.listLines(tx, id);
        if (lines.length === 0) throw new BusinessRuleError('An order needs at least one line');
        await activeItems(
          tx,
          lines.map((l) => ({
            itemId: l.item.id,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            gstRate: l.gstRate,
          })),
        );
        await repo.setOrderState(tx, id, {
          status: 'approved',
          approvedBy: viewer.user.id,
          approvedAt: new Date(),
        });
      });
      audit(viewer, 'order.approve', { orderId: id });
      return run(viewer, (tx) => detail(viewer, tx, id));
    },

    async cancelOrder(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'purchase.order.cancel');
      const id = parseId(rawId);
      const { version } = orderDecisionInputSchema.parse(raw);
      await run(viewer, async (tx) => {
        const order = await lockVisible(tx, viewer, id);
        if (order.version !== version) throw new ConflictError(STALE);
        if (order.status !== 'draft' && order.status !== 'approved') {
          throw new BusinessRuleError(
            order.status === 'cancelled'
              ? 'This order is already cancelled'
              : 'An order that has been received (even partly) cannot be cancelled',
          );
        }
        await repo.setOrderState(tx, id, { status: 'cancelled', cancelledAt: new Date() });
      });
      audit(viewer, 'order.cancel', { orderId: id });
      return run(viewer, (tx) => detail(viewer, tx, id));
    },

    // ---------------------------------------------------------------- receiving

    async receiveGoods(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'purchase.receipt.create');
      const input = receiveGoodsInputSchema.parse(raw);
      await limitWrites(viewer);
      // Always touch stock rows in the same order (by item), so two receipts never deadlock.
      const requested = [...input.lines];
      const receiptNumber = await run(viewer, async (tx, tenantId) => {
        const order = await lockVisible(tx, viewer, input.orderId);
        if (order.status !== 'approved' && order.status !== 'partly_received') {
          throw new BusinessRuleError(
            order.status === 'draft'
              ? 'This order has not been approved yet'
              : 'This order cannot receive goods any more',
          );
        }
        const warehouse = await storeRepo.findWarehouse(tx, input.warehouseId);
        if (!warehouse || !inScope(viewer, { branchId: warehouse.branchId, userId: null })) {
          throw new NotFoundError('Warehouse not found');
        }
        if (warehouse.status !== 'active') {
          throw new ValidationError({ warehouseId: ['This warehouse is inactive'] });
        }

        const orderLines = new Map((await repo.lockLines(tx, input.orderId)).map((l) => [l.id, l]));
        const prepared = requested
          .map((l, index) => {
            const line = orderLines.get(l.orderLineId);
            if (!line) {
              throw new ValidationError({
                [`lines.${index}.orderLineId`]: ['Not a line of this order'],
              });
            }
            const open = Number(line.quantity) - Number(line.receivedQuantity);
            if (Number(l.quantity) > open + 1e-9) {
              const message = `Only ${Number(open.toFixed(3))} left to receive on this line`;
              throw new BusinessRuleError(message, {
                fieldErrors: { [`lines.${index}.quantity`]: [message] },
              });
            }
            return { ...l, itemId: line.itemId };
          })
          .sort((a, b) => a.itemId.localeCompare(b.itemId));

        const number = await repo.nextNumber(tx, tenantId, 'GRN');
        const receiptId = await repo.insertReceipt(tx, {
          tenantId,
          number,
          orderId: input.orderId,
          warehouseId: input.warehouseId,
          supplierInvoiceNo: input.supplierInvoiceNo,
          notes: input.notes,
          receivedBy: viewer.user.id,
        });
        await repo.insertReceiptLines(tx, tenantId, receiptId, prepared);

        for (const line of prepared) {
          // The database check is the final guard against receiving more than was ordered.
          if (!(await repo.addReceived(tx, line.orderLineId, line.quantity))) {
            throw new BusinessRuleError('More than the ordered quantity cannot be received');
          }
          const balance = await storeRepo.applyMovement(tx, {
            tenantId,
            itemId: line.itemId,
            warehouseId: input.warehouseId,
            kind: 'receipt',
            delta: line.quantity,
            reference: number,
            reason: input.supplierInvoiceNo ? `Supplier invoice ${input.supplierInvoiceNo}` : null,
            createdBy: viewer.user.id,
          });
          if (balance === null) {
            const message = `Too much stock: one warehouse can hold at most ${MAX_STOCK}`;
            throw new BusinessRuleError(message, { fieldErrors: { quantity: [message] } });
          }
        }

        const open = await repo.countLinesStillOpen(tx, input.orderId);
        await repo.setOrderState(tx, input.orderId, {
          status: open === 0 ? 'received' : 'partly_received',
        });
        return number;
      });
      audit(viewer, 'order.receive', { orderId: input.orderId, receipt: receiptNumber });
      return run(viewer, (tx) => detail(viewer, tx, input.orderId));
    },
  };
}

export type PurchaseService = ReturnType<typeof createPurchaseService>;
