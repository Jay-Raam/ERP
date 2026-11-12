'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OrderStatus } from '@erp/shared';
import { gqlRequest } from '@/lib/api-client';

export type Status = 'active' | 'inactive';

export interface Supplier {
  id: string;
  code: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  gstin: string | null;
  address: string | null;
  status: Status;
  version: number;
}

export interface OrderSummary {
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
  createdAt: string;
  createdById: string;
  createdByName: string;
  approvedByName: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  supplier: { id: string; code: string; name: string };
  branch: { id: string; code: string; name: string };
}

export interface OrderLine {
  id: string;
  quantity: string;
  receivedQuantity: string;
  unitPrice: string;
  gstRate: number;
  subtotal: string;
  taxAmount: string;
  total: string;
  item: { id: string; sku: string; name: string; unit: string };
}

export interface Receipt {
  id: string;
  number: string;
  supplierInvoiceNo: string | null;
  notes: string | null;
  createdAt: string;
  receivedByName: string;
  warehouse: { id: string; code: string; name: string };
  lines: { quantity: string; item: { id: string; sku: string; name: string; unit: string } }[];
}

export interface OrderDetail extends OrderSummary {
  lines: OrderLine[];
  receipts: Receipt[];
}

export const PAGE_SIZE = 20;

const SUPPLIER = 'id code name contactName email phone gstin address status version';
const ORDER = `id number status orderDate expectedDate notes subtotal taxTotal grandTotal version
  createdAt createdById createdByName approvedByName approvedAt cancelledAt
  supplier { id code name } branch { id code name }`;
const DETAIL = `${ORDER}
  lines { id quantity receivedQuantity unitPrice gstRate subtotal taxAmount total
    item { id sku name unit } }
  receipts { id number supplierInvoiceNo notes createdAt receivedByName
    warehouse { id code name } lines { quantity item { id sku name unit } } }`;

const keys = {
  suppliers: ['purchase', 'suppliers'] as const,
  orders: ['purchase', 'orders'] as const,
  order: ['purchase', 'order'] as const,
};
// A receipt changes stock too, so the store screens must refresh.
const AFTER_RECEIPT = [keys.orders, keys.order, ['store', 'levels'], ['store', 'movements']];

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

// ---------------------------------------------------------------- suppliers

export interface SupplierFilter {
  search: string;
  status: Status | '';
  page: number;
}

export const useSuppliers = (filter: SupplierFilter, enabled = true) =>
  useQuery({
    enabled,
    queryKey: [...keys.suppliers, filter],
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await gqlRequest<{ suppliers: { items: Supplier[]; total: number } }>(
          `query($input: ListSuppliersInput){ suppliers(input:$input){ total items { ${SUPPLIER} } } }`,
          {
            input: {
              search: filter.search || null,
              status: filter.status || null,
              limit: PAGE_SIZE,
              offset: filter.page * PAGE_SIZE,
            },
          },
        )
      ).suppliers,
  });

/** Active suppliers for the order form's picker. */
export const useSupplierOptions = (enabled = true) =>
  useQuery({
    enabled,
    queryKey: [...keys.suppliers, 'options'],
    queryFn: async () =>
      (
        await gqlRequest<{ suppliers: { items: Supplier[] } }>(
          `query($input: ListSuppliersInput){ suppliers(input:$input){ items { ${SUPPLIER} } } }`,
          { input: { status: 'active', limit: 100 } },
        )
      ).suppliers.items,
  });

export const useSaveSupplier = () =>
  useAction(
    async (vars: { id?: string; version?: number; input: Record<string, unknown> }) =>
      vars.id
        ? gqlRequest(
            `mutation($id: ID!, $input: UpdateSupplierInput!){ updateSupplier(id:$id,input:$input){ id } }`,
            { id: vars.id, input: { ...vars.input, version: vars.version } },
          )
        : gqlRequest(
            `mutation($input: CreateSupplierInput!){ createSupplier(input:$input){ id } }`,
            { input: vars.input },
          ),
    [keys.suppliers],
  );

// ------------------------------------------------------------------- orders

export interface OrderFilter {
  search: string;
  status: OrderStatus | '';
  page: number;
}

export const useOrders = (filter: OrderFilter, enabled = true) =>
  useQuery({
    enabled,
    queryKey: [...keys.orders, filter],
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await gqlRequest<{ purchaseOrders: { items: OrderSummary[]; total: number } }>(
          `query($input: ListOrdersInput){ purchaseOrders(input:$input){ total items { ${ORDER} } } }`,
          {
            input: {
              search: filter.search || null,
              status: filter.status || null,
              limit: PAGE_SIZE,
              offset: filter.page * PAGE_SIZE,
            },
          },
        )
      ).purchaseOrders,
  });

export const useOrder = (id: string | null) =>
  useQuery({
    enabled: id !== null,
    queryKey: [...keys.order, id],
    queryFn: async () =>
      (
        await gqlRequest<{ purchaseOrder: OrderDetail }>(
          `query($id: ID!){ purchaseOrder(id:$id){ ${DETAIL} } }`,
          { id },
        )
      ).purchaseOrder,
  });

export const useSaveOrder = () =>
  useAction(
    async (vars: { id?: string; input: Record<string, unknown> }) =>
      vars.id
        ? gqlRequest<{ updatePurchaseOrder: { id: string } }>(
            `mutation($id: ID!, $input: UpdateOrderInput!){ updatePurchaseOrder(id:$id,input:$input){ id } }`,
            { id: vars.id, input: vars.input },
          )
        : gqlRequest<{ createPurchaseOrder: { id: string } }>(
            `mutation($input: CreateOrderInput!){ createPurchaseOrder(input:$input){ id } }`,
            { input: vars.input },
          ),
    [keys.orders, keys.order],
  );

export const useDecideOrder = () =>
  useAction(
    (vars: { id: string; version: number; decision: 'approve' | 'cancel' }) =>
      vars.decision === 'approve'
        ? gqlRequest(
            `mutation($id: ID!, $input: OrderDecisionInput!){ approvePurchaseOrder(id:$id,input:$input){ id } }`,
            { id: vars.id, input: { version: vars.version } },
          )
        : gqlRequest(
            `mutation($id: ID!, $input: OrderDecisionInput!){ cancelPurchaseOrder(id:$id,input:$input){ id } }`,
            { id: vars.id, input: { version: vars.version } },
          ),
    [keys.orders, keys.order],
  );

export const useReceiveGoods = () =>
  useAction(
    (input: Record<string, unknown>) =>
      gqlRequest(`mutation($input: ReceiveGoodsInput!){ receiveGoods(input:$input){ id } }`, {
        input,
      }),
    AFTER_RECEIPT,
  );
