import type { GraphQLContext } from '../../graphql/context';
import type { StoreService } from './store.service';

export const storeTypeDefs = /* GraphQL */ `
  enum MovementKind {
    receipt
    issue
    adjustment
    transfer_out
    transfer_in
  }

  "Quantities are decimal strings (up to 3 decimals) so nothing is rounded by floating point."
  type Item {
    id: ID!
    sku: String!
    name: String!
    unit: String!
    category: String
    reorderLevel: String!
    status: RecordStatus!
    version: Int!
  }

  type ItemPage {
    items: [Item!]!
    total: Int!
  }

  input CreateItemInput {
    sku: String!
    unit: String!
    name: String!
    category: String
    reorderLevel: String
  }

  input UpdateItemInput {
    name: String!
    category: String
    reorderLevel: String
    status: RecordStatus!
    version: Int!
  }

  input ListItemsInput {
    search: String
    status: RecordStatus
    limit: Int
    offset: Int
  }

  type WarehouseBranch {
    id: ID!
    code: String!
    name: String!
  }

  type Warehouse {
    id: ID!
    code: String!
    name: String!
    status: RecordStatus!
    version: Int!
    branch: WarehouseBranch!
  }

  input CreateWarehouseInput {
    code: String!
    name: String!
    branchId: ID!
  }

  input UpdateWarehouseInput {
    name: String!
    status: RecordStatus!
    version: Int!
  }

  input ListWarehousesInput {
    branchId: ID
    status: RecordStatus
  }

  type StockWarehouseQty {
    warehouse: WarehouseBranch!
    quantity: String!
  }

  type StockLevel {
    id: ID!
    sku: String!
    name: String!
    unit: String!
    status: RecordStatus!
    reorderLevel: String!
    "Total across the warehouses you can see (or the one you filtered on)."
    onHand: String!
    "True when a reorder level is set and the total is at or below it."
    low: Boolean!
    byWarehouse: [StockWarehouseQty!]!
  }

  type StockLevelPage {
    items: [StockLevel!]!
    total: Int!
  }

  input StockLevelsInput {
    search: String
    warehouseId: ID
    lowOnly: Boolean
    limit: Int
    offset: Int
  }

  type MovementItem {
    id: ID!
    sku: String!
    name: String!
    unit: String!
  }

  type StockMovement {
    id: ID!
    kind: MovementKind!
    "Signed: positive adds stock, negative removes it."
    quantity: String!
    balanceAfter: String!
    reference: String
    reason: String
    createdAt: String!
    transferId: ID
    item: MovementItem!
    warehouse: WarehouseBranch!
    createdByName: String!
  }

  type MovementPage {
    items: [StockMovement!]!
    total: Int!
  }

  input MovementsInput {
    itemId: ID
    warehouseId: ID
    kind: MovementKind
    limit: Int
    offset: Int
  }

  input ReceiveStockInput {
    itemId: ID!
    warehouseId: ID!
    quantity: String!
    reference: String
    reason: String
  }

  input IssueStockInput {
    itemId: ID!
    warehouseId: ID!
    quantity: String!
    reference: String
    reason: String
  }

  input AdjustStockInput {
    itemId: ID!
    warehouseId: ID!
    "Positive adds, negative removes."
    quantity: String!
    reason: String!
  }

  input TransferStockInput {
    itemId: ID!
    fromWarehouseId: ID!
    toWarehouseId: ID!
    quantity: String!
    reference: String
    reason: String
  }

  type StockChange {
    itemId: ID!
    warehouseId: ID!
    "The warehouse's quantity after the change."
    balance: String!
  }

  type StockTransfer {
    itemId: ID!
    transferId: ID!
    fromBalance: String!
    toBalance: String!
  }

  extend type Query {
    items(input: ListItemsInput): ItemPage!
    item(id: ID!): Item!
    warehouses(input: ListWarehousesInput): [Warehouse!]!
    stockLevels(input: StockLevelsInput): StockLevelPage!
    stockMovements(input: MovementsInput): MovementPage!
  }

  extend type Mutation {
    createItem(input: CreateItemInput!): Item!
    updateItem(id: ID!, input: UpdateItemInput!): Item!
    createWarehouse(input: CreateWarehouseInput!): Warehouse!
    updateWarehouse(id: ID!, input: UpdateWarehouseInput!): Warehouse!
    receiveStock(input: ReceiveStockInput!): StockChange!
    issueStock(input: IssueStockInput!): StockChange!
    adjustStock(input: AdjustStockInput!): StockChange!
    transferStock(input: TransferStockInput!): StockTransfer!
  }
`;

type Args<T> = { input: T };
type IdArgs<T> = { id: string; input: T };

export function storeResolvers(store: StoreService) {
  return {
    Query: {
      items: async (_p: unknown, a: { input?: unknown }, ctx: GraphQLContext) =>
        store.listItems(await ctx.viewer(), a.input),
      item: async (_p: unknown, a: { id: string }, ctx: GraphQLContext) =>
        store.getItem(await ctx.viewer(), a.id),
      warehouses: async (_p: unknown, a: { input?: unknown }, ctx: GraphQLContext) =>
        store.listWarehouses(await ctx.viewer(), a.input),
      stockLevels: async (_p: unknown, a: { input?: unknown }, ctx: GraphQLContext) =>
        store.stockLevels(await ctx.viewer(), a.input),
      stockMovements: async (_p: unknown, a: { input?: unknown }, ctx: GraphQLContext) => {
        const page = await store.movements(await ctx.viewer(), a.input);
        return {
          total: page.total,
          items: page.items.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
        };
      },
    },
    Mutation: {
      createItem: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        store.createItem(await ctx.viewer(), a.input),
      updateItem: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        store.updateItem(await ctx.viewer(), a.id, a.input),
      createWarehouse: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        store.createWarehouse(await ctx.viewer(), a.input),
      updateWarehouse: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        store.updateWarehouse(await ctx.viewer(), a.id, a.input),
      receiveStock: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        store.receive(await ctx.viewer(), a.input),
      issueStock: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        store.issue(await ctx.viewer(), a.input),
      adjustStock: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        store.adjust(await ctx.viewer(), a.input),
      transferStock: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        store.transfer(await ctx.viewer(), a.input),
    },
  };
}
