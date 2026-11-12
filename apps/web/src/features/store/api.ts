'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MovementKind, Unit } from '@erp/shared';
import { gqlRequest } from '@/lib/api-client';

export type Status = 'active' | 'inactive';

export interface Item {
  id: string;
  sku: string;
  name: string;
  unit: Unit;
  category: string | null;
  reorderLevel: string;
  status: Status;
  version: number;
}

export interface Warehouse {
  id: string;
  code: string;
  name: string;
  status: Status;
  version: number;
  branch: { id: string; code: string; name?: string };
}

export interface StockLevel {
  id: string;
  sku: string;
  name: string;
  unit: Unit;
  status: Status;
  reorderLevel: string;
  onHand: string;
  low: boolean;
  byWarehouse: { quantity: string; warehouse: { id?: string; code: string } }[];
}

export interface Movement {
  id: string;
  kind: MovementKind;
  quantity: string;
  balanceAfter: string;
  reference: string | null;
  reason: string | null;
  createdAt: string;
  transferId: string | null;
  createdByName: string;
  item: { id: string; sku: string; name: string; unit: Unit };
  warehouse: { id?: string; code: string };
}

export const PAGE_SIZE = 20;

const ITEM = 'id sku name unit category reorderLevel status version';
const WAREHOUSE = 'id code name status version branch { id code name }';

const keys = {
  items: ['store', 'items'] as const,
  warehouses: ['store', 'warehouses'] as const,
  levels: ['store', 'levels'] as const,
  movements: ['store', 'movements'] as const,
};
const STOCK_KEYS = [keys.levels, keys.movements];

function useAction<TVars, TResult>(
  run: (vars: TVars) => Promise<TResult>,
  invalidate: (readonly string[])[],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await Promise.all(
        invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] })),
      );
    },
  });
}

// -------------------------------------------------------------------- items

export interface ItemFilter {
  search: string;
  status: Status | '';
  page: number;
}

export const useItems = (filter: ItemFilter, enabled = true) =>
  useQuery({
    enabled,
    queryKey: [...keys.items, filter],
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await gqlRequest<{ items: { items: Item[]; total: number } }>(
          `query($input: ListItemsInput){ items(input:$input){ total items { ${ITEM} } } }`,
          {
            input: {
              search: filter.search || null,
              status: filter.status || null,
              limit: PAGE_SIZE,
              offset: filter.page * PAGE_SIZE,
            },
          },
        )
      ).items,
  });

/** Active items for the pickers in the stock forms. */
export const useItemOptions = (enabled = true) =>
  useQuery({
    enabled,
    queryKey: [...keys.items, 'options'],
    queryFn: async () =>
      (
        await gqlRequest<{ items: { items: Item[] } }>(
          `query($input: ListItemsInput){ items(input:$input){ items { ${ITEM} } } }`,
          { input: { status: 'active', limit: 100 } },
        )
      ).items.items,
  });

export const useSaveItem = () =>
  useAction(
    async (vars: { id?: string; version?: number; input: Record<string, unknown> }) =>
      vars.id
        ? gqlRequest(
            `mutation($id: ID!, $input: UpdateItemInput!){ updateItem(id:$id,input:$input){ id } }`,
            { id: vars.id, input: { ...vars.input, version: vars.version } },
          )
        : gqlRequest(`mutation($input: CreateItemInput!){ createItem(input:$input){ id } }`, {
            input: vars.input,
          }),
    [keys.items, keys.levels],
  );

// --------------------------------------------------------------- warehouses

export const useWarehouses = (enabled = true) =>
  useQuery({
    enabled,
    queryKey: keys.warehouses,
    queryFn: async () =>
      (await gqlRequest<{ warehouses: Warehouse[] }>(`{ warehouses { ${WAREHOUSE} } }`)).warehouses,
  });

export const useSaveWarehouse = () =>
  useAction(
    async (vars: { id?: string; version?: number; input: Record<string, unknown> }) =>
      vars.id
        ? gqlRequest(
            `mutation($id: ID!, $input: UpdateWarehouseInput!){ updateWarehouse(id:$id,input:$input){ id } }`,
            { id: vars.id, input: { ...vars.input, version: vars.version } },
          )
        : gqlRequest(
            `mutation($input: CreateWarehouseInput!){ createWarehouse(input:$input){ id } }`,
            { input: vars.input },
          ),
    [keys.warehouses, keys.levels],
  );

// -------------------------------------------------------------------- stock

export interface LevelFilter {
  search: string;
  warehouseId: string;
  lowOnly: boolean;
  page: number;
}

export const useStockLevels = (filter: LevelFilter, enabled = true) =>
  useQuery({
    enabled,
    queryKey: [...keys.levels, filter],
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await gqlRequest<{ stockLevels: { items: StockLevel[]; total: number } }>(
          `query($input: StockLevelsInput){ stockLevels(input:$input){ total items {
            id sku name unit status reorderLevel onHand low
            byWarehouse { quantity warehouse { id code } } } } }`,
          {
            input: {
              search: filter.search || null,
              warehouseId: filter.warehouseId || null,
              lowOnly: filter.lowOnly,
              limit: PAGE_SIZE,
              offset: filter.page * PAGE_SIZE,
            },
          },
        )
      ).stockLevels,
  });

export interface MovementFilter {
  itemId: string;
  warehouseId: string;
  kind: MovementKind | '';
  page: number;
}

export const useMovements = (filter: MovementFilter, enabled = true) =>
  useQuery({
    enabled,
    queryKey: [...keys.movements, filter],
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await gqlRequest<{ stockMovements: { items: Movement[]; total: number } }>(
          `query($input: MovementsInput){ stockMovements(input:$input){ total items {
            id kind quantity balanceAfter reference reason createdAt transferId createdByName
            item { id sku name unit } warehouse { id code } } } }`,
          {
            input: {
              itemId: filter.itemId || null,
              warehouseId: filter.warehouseId || null,
              kind: filter.kind || null,
              limit: PAGE_SIZE,
              offset: filter.page * PAGE_SIZE,
            },
          },
        )
      ).stockMovements,
  });

export type StockAction = 'receive' | 'issue' | 'adjust' | 'transfer';

const MUTATIONS: Record<StockAction, string> = {
  receive: `mutation($input: ReceiveStockInput!){ receiveStock(input:$input){ balance } }`,
  issue: `mutation($input: IssueStockInput!){ issueStock(input:$input){ balance } }`,
  adjust: `mutation($input: AdjustStockInput!){ adjustStock(input:$input){ balance } }`,
  transfer: `mutation($input: TransferStockInput!){ transferStock(input:$input){ transferId } }`,
};

export const useStockAction = () =>
  useAction(
    (vars: { action: StockAction; input: Record<string, unknown> }) =>
      gqlRequest(MUTATIONS[vars.action], { input: vars.input }),
    STOCK_KEYS,
  );
