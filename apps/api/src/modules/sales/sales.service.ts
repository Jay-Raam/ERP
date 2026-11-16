import {
  hasPermission,
  createSalesOrderInputSchema,
  createCustomerInputSchema,
  lineAmounts,
  listSalesOrdersInputSchema,
  listCustomersInputSchema,
  orderAmounts,
  salesDecisionInputSchema,
  paiseToString,
  deliverGoodsInputSchema,
  updateSalesOrderInputSchema,
  updateCustomerInputSchema,
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
import * as repo from './sales.repository';

const STALE = 'Someone else changed this record. Reload it and try again.';

export interface SalesDeps {
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

export function createSalesService({ db, logger, limiter, limits }: SalesDeps) {
  const run = <T>(viewer: Viewer, fn: (tx: TenantTx, tenantId: string) => Promise<T>) =>
    withTenant(db, viewer.organisation.id, (tx) => fn(tx, viewer.organisation.id));

  const audit = (viewer: Viewer, action: string, target: Record<string, unknown>) =>
    logger.info(
      { audit: true, actor: viewer.user.id, tenantId: viewer.organisation.id, action, ...target },
      'sales action',
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

  async function activeCustomer(tx: TenantTx, id: string) {
    const customer = await repo.findCustomer(tx, id);
    if (!customer) throw new ValidationError({ customerId: ['Choose a customer'] });
    if (customer.status !== 'active') {
      throw new ValidationError({ customerId: ['This customer is inactive'] });
    }
    return customer;
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
      throw new NotFoundError('Sales order not found');
    }
    const canSeeDeliveries = hasPermission(viewer.permissions, 'sale.delivery.view');
    return {
      ...order,
      lines: await repo.listLines(tx, id),
      deliveries: canSeeDeliveries ? await repo.listDeliveries(tx, id) : [],
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
    if (!order || !visible(viewer, order)) throw new NotFoundError('Sales order not found');
    return order;
  }

  return {
    // -------------------------------------------------------------- customers

    async listCustomers(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'sale.customer.view');
      const input = listCustomersInputSchema.parse(raw ?? {});
      return run(viewer, (tx) => repo.listCustomers(tx, input));
    },

    async getCustomer(viewer: Viewer, rawId: unknown) {
      requirePermission(viewer, 'sale.customer.view');
      const id = parseId(rawId);
      const customer = await run(viewer, (tx) => repo.findCustomer(tx, id));
      if (!customer) throw new NotFoundError('Customer not found');
      return customer;
    },

    async createCustomer(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'sale.customer.create');
      const input = createCustomerInputSchema.parse(raw);
      try {
        const id = await run(viewer, (tx, tenantId) =>
          repo.insertCustomer(tx, { ...input, tenantId }),
        );
        audit(viewer, 'customer.create', { customerId: id });
        return (await run(viewer, (tx) => repo.findCustomer(tx, id)))!;
      } catch (error) {
        return mapConflict(error, 'A customer with this code', 'code');
      }
    },

    async updateCustomer(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'sale.customer.update');
      const id = parseId(rawId);
      const { version, ...values } = updateCustomerInputSchema.parse(raw);
      await run(viewer, async (tx) => {
        if (!(await repo.findCustomer(tx, id))) throw new NotFoundError('Customer not found');
        if (!(await repo.updateCustomer(tx, id, version, values))) throw new ConflictError(STALE);
      });
      audit(viewer, 'customer.update', { customerId: id });
      return (await run(viewer, (tx) => repo.findCustomer(tx, id)))!;
    },

    // ----------------------------------------------------------------- orders

    async listOrders(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'sale.order.view');
      const input = listSalesOrdersInputSchema.parse(raw ?? {});
      return run(viewer, (tx) =>
        repo.listOrders(tx, { ...input, scope: scopeOf(viewer), userId: viewer.user.id }),
      );
    },

    async getOrder(viewer: Viewer, rawId: unknown) {
      requirePermission(viewer, 'sale.order.view');
      const id = parseId(rawId);
      return run(viewer, (tx) => detail(viewer, tx, id));
    },

    async createOrder(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'sale.order.create');
      const { lines, branchId, ...head } = createSalesOrderInputSchema.parse(raw);
      assertBranchInScope(viewer, branchId);
      const priced = priceLines(lines);
      const id = await run(viewer, async (tx, tenantId) => {
        await activeCustomer(tx, head.customerId);
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
          number: await repo.nextNumber(tx, tenantId, 'SO'),
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
      requirePermission(viewer, 'sale.order.create');
      const id = parseId(rawId);
      const { version, lines, ...head } = updateSalesOrderInputSchema.parse(raw);
      const priced = priceLines(lines);
      await run(viewer, async (tx, tenantId) => {
        const order = await lockVisible(tx, viewer, id);
        if (order.status !== 'draft') {
          throw new BusinessRuleError('Only a draft order can be edited');
        }
        await activeCustomer(tx, head.customerId);
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

    async confirmOrder(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'sale.order.approve');
      const id = parseId(rawId);
      const { version } = salesDecisionInputSchema.parse(raw);
      await run(viewer, async (tx) => {
        const order = await lockVisible(tx, viewer, id);
        if (order.version !== version) throw new ConflictError(STALE);
        if (order.status !== 'draft') {
          throw new BusinessRuleError('Only a draft order can be confirmed');
        }
        if (order.createdBy === viewer.user.id) {
          throw new BusinessRuleError('You cannot confirm an order you created');
        }
        await activeCustomer(tx, order.customerId);
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
          status: 'confirmed',
          confirmedBy: viewer.user.id,
          confirmedAt: new Date(),
        });
      });
      audit(viewer, 'order.confirm', { orderId: id });
      return run(viewer, (tx) => detail(viewer, tx, id));
    },

    async cancelOrder(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'sale.order.cancel');
      const id = parseId(rawId);
      const { version } = salesDecisionInputSchema.parse(raw);
      await run(viewer, async (tx) => {
        const order = await lockVisible(tx, viewer, id);
        if (order.version !== version) throw new ConflictError(STALE);
        if (order.status !== 'draft' && order.status !== 'confirmed') {
          throw new BusinessRuleError(
            order.status === 'cancelled'
              ? 'This order is already cancelled'
              : 'An order that has been delivered (even partly) cannot be cancelled',
          );
        }
        await repo.setOrderState(tx, id, { status: 'cancelled', cancelledAt: new Date() });
      });
      audit(viewer, 'order.cancel', { orderId: id });
      return run(viewer, (tx) => detail(viewer, tx, id));
    },

    // --------------------------------------------------------------- delivering

    async deliverGoods(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'sale.delivery.create');
      const input = deliverGoodsInputSchema.parse(raw);
      await limitWrites(viewer);
      // Always touch stock rows in the same order (by item), so two deliveries never deadlock.
      const requested = [...input.lines];
      const deliveryNumber = await run(viewer, async (tx, tenantId) => {
        const order = await lockVisible(tx, viewer, input.orderId);
        if (order.status !== 'confirmed' && order.status !== 'partly_delivered') {
          throw new BusinessRuleError(
            order.status === 'draft'
              ? 'This order has not been confirmed yet'
              : 'This order cannot deliver goods any more',
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
            const open = Number(line.quantity) - Number(line.deliveredQuantity);
            if (Number(l.quantity) > open + 1e-9) {
              const message = `Only ${Number(open.toFixed(3))} left to deliver on this line`;
              throw new BusinessRuleError(message, {
                fieldErrors: { [`lines.${index}.quantity`]: [message] },
              });
            }
            return { ...l, itemId: line.itemId, index };
          })
          .sort((a, b) => a.itemId.localeCompare(b.itemId));

        const number = await repo.nextNumber(tx, tenantId, 'DN');
        const deliveryId = await repo.insertDelivery(tx, {
          tenantId,
          number,
          orderId: input.orderId,
          warehouseId: input.warehouseId,
          reference: input.reference,
          notes: input.notes,
          deliveredBy: viewer.user.id,
        });
        await repo.insertDeliveryLines(tx, tenantId, deliveryId, prepared);

        for (const line of prepared) {
          // The database check is the final guard against delivering more than was ordered.
          if (!(await repo.addDelivered(tx, line.orderLineId, line.quantity))) {
            throw new BusinessRuleError('More than the ordered quantity cannot be delivered');
          }
          const balance = await storeRepo.applyMovement(tx, {
            tenantId,
            itemId: line.itemId,
            warehouseId: input.warehouseId,
            kind: 'issue',
            delta: `-${line.quantity}`,
            reference: number,
            reason: input.reference ? `Customer reference ${input.reference}` : null,
            createdBy: viewer.user.id,
          });
          if (balance === null) {
            const onHand = Number(
              await storeRepo.currentBalance(tx, line.itemId, input.warehouseId),
            );
            const message = `Not enough stock: only ${onHand} on hand in this warehouse`;
            throw new BusinessRuleError(message, {
              fieldErrors: { [`lines.${line.index}.quantity`]: [message] },
            });
          }
        }

        const open = await repo.countLinesStillOpen(tx, input.orderId);
        await repo.setOrderState(tx, input.orderId, {
          status: open === 0 ? 'delivered' : 'partly_delivered',
        });
        return number;
      });
      audit(viewer, 'order.deliver', { orderId: input.orderId, receipt: deliveryNumber });
      return run(viewer, (tx) => detail(viewer, tx, input.orderId));
    },
  };
}

export type SalesService = ReturnType<typeof createSalesService>;
