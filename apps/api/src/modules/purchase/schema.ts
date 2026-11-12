import type { GraphQLContext } from '../../graphql/context';
import type { PurchaseService } from './purchase.service';

export const purchaseTypeDefs = /* GraphQL */ `
  enum PurchaseOrderStatus {
    draft
    approved
    partly_received
    received
    cancelled
  }

  type Supplier {
    id: ID!
    code: String!
    name: String!
    contactName: String
    email: String
    phone: String
    gstin: String
    address: String
    status: RecordStatus!
    version: Int!
  }

  type SupplierPage {
    items: [Supplier!]!
    total: Int!
  }

  input CreateSupplierInput {
    code: String!
    name: String!
    contactName: String
    email: String
    phone: String
    gstin: String
    address: String
  }

  input UpdateSupplierInput {
    name: String!
    contactName: String
    email: String
    phone: String
    gstin: String
    address: String
    status: RecordStatus!
    version: Int!
  }

  input ListSuppliersInput {
    search: String
    status: RecordStatus
    limit: Int
    offset: Int
  }

  type OrderSupplier {
    id: ID!
    code: String!
    name: String!
  }

  type OrderBranch {
    id: ID!
    code: String!
    name: String!
  }

  type OrderItem {
    id: ID!
    sku: String!
    name: String!
    unit: String!
  }

  "Money is a decimal string with two decimals. Every amount is worked out by the server."
  type PurchaseOrderLine {
    id: ID!
    item: OrderItem!
    quantity: String!
    receivedQuantity: String!
    unitPrice: String!
    gstRate: Int!
    subtotal: String!
    taxAmount: String!
    total: String!
  }

  type GoodsReceiptLine {
    item: OrderItem!
    quantity: String!
  }

  type ReceiptWarehouse {
    id: ID!
    code: String!
    name: String!
  }

  type GoodsReceipt {
    id: ID!
    number: String!
    supplierInvoiceNo: String
    notes: String
    createdAt: String!
    receivedByName: String!
    warehouse: ReceiptWarehouse!
    lines: [GoodsReceiptLine!]!
  }

  type PurchaseOrder {
    id: ID!
    number: String!
    status: PurchaseOrderStatus!
    orderDate: String!
    expectedDate: String
    notes: String
    subtotal: String!
    taxTotal: String!
    grandTotal: String!
    version: Int!
    createdAt: String!
    createdById: ID!
    createdByName: String!
    approvedByName: String
    approvedAt: String
    cancelledAt: String
    supplier: OrderSupplier!
    branch: OrderBranch!
  }

  type PurchaseOrderDetail {
    id: ID!
    number: String!
    status: PurchaseOrderStatus!
    orderDate: String!
    expectedDate: String
    notes: String
    subtotal: String!
    taxTotal: String!
    grandTotal: String!
    version: Int!
    createdAt: String!
    createdById: ID!
    createdByName: String!
    approvedByName: String
    approvedAt: String
    cancelledAt: String
    supplier: OrderSupplier!
    branch: OrderBranch!
    lines: [PurchaseOrderLine!]!
    receipts: [GoodsReceipt!]!
  }

  type PurchaseOrderPage {
    items: [PurchaseOrder!]!
    total: Int!
  }

  input OrderLineInput {
    itemId: ID!
    quantity: String!
    unitPrice: String!
    gstRate: Int!
  }

  input CreateOrderInput {
    supplierId: ID!
    branchId: ID!
    orderDate: String!
    expectedDate: String
    notes: String
    lines: [OrderLineInput!]!
  }

  input UpdateOrderInput {
    supplierId: ID!
    orderDate: String!
    expectedDate: String
    notes: String
    lines: [OrderLineInput!]!
    version: Int!
  }

  input OrderDecisionInput {
    version: Int!
  }

  input ListOrdersInput {
    search: String
    status: PurchaseOrderStatus
    supplierId: ID
    limit: Int
    offset: Int
  }

  input ReceiveLineInput {
    orderLineId: ID!
    quantity: String!
  }

  input ReceiveGoodsInput {
    orderId: ID!
    warehouseId: ID!
    supplierInvoiceNo: String
    notes: String
    lines: [ReceiveLineInput!]!
  }

  extend type Query {
    suppliers(input: ListSuppliersInput): SupplierPage!
    supplier(id: ID!): Supplier!
    purchaseOrders(input: ListOrdersInput): PurchaseOrderPage!
    purchaseOrder(id: ID!): PurchaseOrderDetail!
  }

  extend type Mutation {
    createSupplier(input: CreateSupplierInput!): Supplier!
    updateSupplier(id: ID!, input: UpdateSupplierInput!): Supplier!
    createPurchaseOrder(input: CreateOrderInput!): PurchaseOrderDetail!
    updatePurchaseOrder(id: ID!, input: UpdateOrderInput!): PurchaseOrderDetail!
    approvePurchaseOrder(id: ID!, input: OrderDecisionInput!): PurchaseOrderDetail!
    cancelPurchaseOrder(id: ID!, input: OrderDecisionInput!): PurchaseOrderDetail!
    receiveGoods(input: ReceiveGoodsInput!): PurchaseOrderDetail!
  }
`;

type Args<T> = { input: T };
type IdArgs<T> = { id: string; input: T };

const iso = (d: Date | null) => (d ? d.toISOString() : null);

type OrderHead = {
  createdBy: string;
  createdAt: Date;
  approvedAt: Date | null;
  cancelledAt: Date | null;
};

const dates = <T extends OrderHead>(o: T) => ({
  ...o,
  createdById: o.createdBy,
  createdAt: o.createdAt.toISOString(),
  approvedAt: iso(o.approvedAt),
  cancelledAt: iso(o.cancelledAt),
});

type Detail = Awaited<ReturnType<PurchaseService['getOrder']>>;

const shapeDetail = (o: Detail) => ({
  ...dates(o),
  receipts: o.receipts.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
});

export function purchaseResolvers(purchase: PurchaseService) {
  return {
    Query: {
      suppliers: async (_p: unknown, a: { input?: unknown }, ctx: GraphQLContext) =>
        purchase.listSuppliers(await ctx.viewer(), a.input),
      supplier: async (_p: unknown, a: { id: string }, ctx: GraphQLContext) =>
        purchase.getSupplier(await ctx.viewer(), a.id),
      purchaseOrders: async (_p: unknown, a: { input?: unknown }, ctx: GraphQLContext) => {
        const page = await purchase.listOrders(await ctx.viewer(), a.input);
        return { total: page.total, items: page.items.map(dates) };
      },
      purchaseOrder: async (_p: unknown, a: { id: string }, ctx: GraphQLContext) =>
        shapeDetail(await purchase.getOrder(await ctx.viewer(), a.id)),
    },
    Mutation: {
      createSupplier: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        purchase.createSupplier(await ctx.viewer(), a.input),
      updateSupplier: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        purchase.updateSupplier(await ctx.viewer(), a.id, a.input),
      createPurchaseOrder: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        shapeDetail(await purchase.createOrder(await ctx.viewer(), a.input)),
      updatePurchaseOrder: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        shapeDetail(await purchase.updateOrder(await ctx.viewer(), a.id, a.input)),
      approvePurchaseOrder: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        shapeDetail(await purchase.approveOrder(await ctx.viewer(), a.id, a.input)),
      cancelPurchaseOrder: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        shapeDetail(await purchase.cancelOrder(await ctx.viewer(), a.id, a.input)),
      receiveGoods: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        shapeDetail(await purchase.receiveGoods(await ctx.viewer(), a.input)),
    },
  };
}
