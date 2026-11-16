import type { GraphQLContext } from '../../graphql/context';
import type { SalesService } from './sales.service';

export const salesTypeDefs = /* GraphQL */ `
  enum SalesOrderStatus {
    draft
    confirmed
    partly_delivered
    delivered
    cancelled
  }

  type Customer {
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

  type CustomerPage {
    items: [Customer!]!
    total: Int!
  }

  input CreateCustomerInput {
    code: String!
    name: String!
    contactName: String
    email: String
    phone: String
    gstin: String
    address: String
  }

  input UpdateCustomerInput {
    name: String!
    contactName: String
    email: String
    phone: String
    gstin: String
    address: String
    status: RecordStatus!
    version: Int!
  }

  input ListCustomersInput {
    search: String
    status: RecordStatus
    limit: Int
    offset: Int
  }

  type SalesOrderCustomer {
    id: ID!
    code: String!
    name: String!
  }

  type SalesOrderBranch {
    id: ID!
    code: String!
    name: String!
  }

  type SalesOrderItem {
    id: ID!
    sku: String!
    name: String!
    unit: String!
  }

  "Money is a decimal string with two decimals. Every amount is worked out by the server."
  type SalesOrderLine {
    id: ID!
    item: SalesOrderItem!
    quantity: String!
    deliveredQuantity: String!
    unitPrice: String!
    gstRate: Int!
    subtotal: String!
    taxAmount: String!
    total: String!
  }

  type DeliveryLine {
    item: SalesOrderItem!
    quantity: String!
  }

  type DeliveryWarehouse {
    id: ID!
    code: String!
    name: String!
  }

  type Delivery {
    id: ID!
    number: String!
    reference: String
    notes: String
    createdAt: String!
    deliveredByName: String!
    warehouse: DeliveryWarehouse!
    lines: [DeliveryLine!]!
  }

  type SalesOrder {
    id: ID!
    number: String!
    status: SalesOrderStatus!
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
    confirmedByName: String
    confirmedAt: String
    cancelledAt: String
    customer: SalesOrderCustomer!
    branch: SalesOrderBranch!
  }

  type SalesOrderDetail {
    id: ID!
    number: String!
    status: SalesOrderStatus!
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
    confirmedByName: String
    confirmedAt: String
    cancelledAt: String
    customer: SalesOrderCustomer!
    branch: SalesOrderBranch!
    lines: [SalesOrderLine!]!
    deliveries: [Delivery!]!
  }

  type SalesOrderPage {
    items: [SalesOrder!]!
    total: Int!
  }

  input SalesOrderLineInput {
    itemId: ID!
    quantity: String!
    unitPrice: String!
    gstRate: Int!
  }

  input CreateSalesOrderInput {
    customerId: ID!
    branchId: ID!
    orderDate: String!
    expectedDate: String
    notes: String
    lines: [SalesOrderLineInput!]!
  }

  input UpdateSalesOrderInput {
    customerId: ID!
    orderDate: String!
    expectedDate: String
    notes: String
    lines: [SalesOrderLineInput!]!
    version: Int!
  }

  input SalesDecisionInput {
    version: Int!
  }

  input ListSalesOrdersInput {
    search: String
    status: SalesOrderStatus
    customerId: ID
    limit: Int
    offset: Int
  }

  input DeliverLineInput {
    orderLineId: ID!
    quantity: String!
  }

  input DeliverGoodsInput {
    orderId: ID!
    warehouseId: ID!
    reference: String
    notes: String
    lines: [DeliverLineInput!]!
  }

  extend type Query {
    customers(input: ListCustomersInput): CustomerPage!
    customer(id: ID!): Customer!
    salesOrders(input: ListSalesOrdersInput): SalesOrderPage!
    salesOrder(id: ID!): SalesOrderDetail!
  }

  extend type Mutation {
    createCustomer(input: CreateCustomerInput!): Customer!
    updateCustomer(id: ID!, input: UpdateCustomerInput!): Customer!
    createSalesOrder(input: CreateSalesOrderInput!): SalesOrderDetail!
    updateSalesOrder(id: ID!, input: UpdateSalesOrderInput!): SalesOrderDetail!
    confirmSalesOrder(id: ID!, input: SalesDecisionInput!): SalesOrderDetail!
    cancelSalesOrder(id: ID!, input: SalesDecisionInput!): SalesOrderDetail!
    deliverGoods(input: DeliverGoodsInput!): SalesOrderDetail!
  }
`;

type Args<T> = { input: T };
type IdArgs<T> = { id: string; input: T };

const iso = (d: Date | null) => (d ? d.toISOString() : null);

type OrderHead = {
  createdBy: string;
  createdAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
};

const dates = <T extends OrderHead>(o: T) => ({
  ...o,
  createdById: o.createdBy,
  createdAt: o.createdAt.toISOString(),
  confirmedAt: iso(o.confirmedAt),
  cancelledAt: iso(o.cancelledAt),
});

type Detail = Awaited<ReturnType<SalesService['getOrder']>>;

const shapeDetail = (o: Detail) => ({
  ...dates(o),
  deliveries: o.deliveries.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
});

export function salesResolvers(sales: SalesService) {
  return {
    Query: {
      customers: async (_p: unknown, a: { input?: unknown }, ctx: GraphQLContext) =>
        sales.listCustomers(await ctx.viewer(), a.input),
      customer: async (_p: unknown, a: { id: string }, ctx: GraphQLContext) =>
        sales.getCustomer(await ctx.viewer(), a.id),
      salesOrders: async (_p: unknown, a: { input?: unknown }, ctx: GraphQLContext) => {
        const page = await sales.listOrders(await ctx.viewer(), a.input);
        return { total: page.total, items: page.items.map(dates) };
      },
      salesOrder: async (_p: unknown, a: { id: string }, ctx: GraphQLContext) =>
        shapeDetail(await sales.getOrder(await ctx.viewer(), a.id)),
    },
    Mutation: {
      createCustomer: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        sales.createCustomer(await ctx.viewer(), a.input),
      updateCustomer: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        sales.updateCustomer(await ctx.viewer(), a.id, a.input),
      createSalesOrder: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        shapeDetail(await sales.createOrder(await ctx.viewer(), a.input)),
      updateSalesOrder: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        shapeDetail(await sales.updateOrder(await ctx.viewer(), a.id, a.input)),
      confirmSalesOrder: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        shapeDetail(await sales.confirmOrder(await ctx.viewer(), a.id, a.input)),
      cancelSalesOrder: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        shapeDetail(await sales.cancelOrder(await ctx.viewer(), a.id, a.input)),
      deliverGoods: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        shapeDetail(await sales.deliverGoods(await ctx.viewer(), a.input)),
    },
  };
}
