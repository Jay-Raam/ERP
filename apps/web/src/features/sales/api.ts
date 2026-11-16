'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SalesOrderStatus } from '@erp/shared';
import { gqlRequest } from '@/lib/api-client';

export type Status = 'active' | 'inactive';

export interface Customer {
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
  status: SalesOrderStatus;
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
  confirmedByName: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  customer: { id: string; code: string; name: string };
  branch: { id: string; code: string; name: string };
}

export interface OrderLine {
  id: string;
  quantity: string;
  deliveredQuantity: string;
  unitPrice: string;
  gstRate: number;
  subtotal: string;
  taxAmount: string;
  total: string;
  item: { id: string; sku: string; name: string; unit: string };
}

export interface Delivery {
  id: string;
  number: string;
  reference: string | null;
  notes: string | null;
  createdAt: string;
  deliveredByName: string;
  warehouse: { id: string; code: string; name: string };
  lines: { quantity: string; item: { id: string; sku: string; name: string; unit: string } }[];
}

export interface OrderDetail extends OrderSummary {
  lines: OrderLine[];
  deliveries: Delivery[];
}

export const PAGE_SIZE = 20;

const CUSTOMER = 'id code name contactName email phone gstin address status version';
const ORDER = `id number status orderDate expectedDate notes subtotal taxTotal grandTotal version
  createdAt createdById createdByName confirmedByName confirmedAt cancelledAt
  customer { id code name } branch { id code name }`;
const DETAIL = `${ORDER}
  lines { id quantity deliveredQuantity unitPrice gstRate subtotal taxAmount total
    item { id sku name unit } }
  deliveries { id number reference notes createdAt deliveredByName
    warehouse { id code name } lines { quantity item { id sku name unit } } }`;

const keys = {
  customers: ['sale', 'customers'] as const,
  orders: ['sale', 'orders'] as const,
  order: ['sale', 'order'] as const,
};
// A delivery changes stock too, so the store screens must refresh.
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

// ---------------------------------------------------------------- customers

export interface CustomerFilter {
  search: string;
  status: Status | '';
  page: number;
}

export const useCustomers = (filter: CustomerFilter, enabled = true) =>
  useQuery({
    enabled,
    queryKey: [...keys.customers, filter],
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await gqlRequest<{ customers: { items: Customer[]; total: number } }>(
          `query($input: ListCustomersInput){ customers(input:$input){ total items { ${CUSTOMER} } } }`,
          {
            input: {
              search: filter.search || null,
              status: filter.status || null,
              limit: PAGE_SIZE,
              offset: filter.page * PAGE_SIZE,
            },
          },
        )
      ).customers,
  });

/** Active customers for the order form's picker. */
export const useCustomerOptions = (enabled = true) =>
  useQuery({
    enabled,
    queryKey: [...keys.customers, 'options'],
    queryFn: async () =>
      (
        await gqlRequest<{ customers: { items: Customer[] } }>(
          `query($input: ListCustomersInput){ customers(input:$input){ items { ${CUSTOMER} } } }`,
          { input: { status: 'active', limit: 100 } },
        )
      ).customers.items,
  });

export const useSaveCustomer = () =>
  useAction(
    async (vars: { id?: string; version?: number; input: Record<string, unknown> }) =>
      vars.id
        ? gqlRequest(
            `mutation($id: ID!, $input: UpdateCustomerInput!){ updateCustomer(id:$id,input:$input){ id } }`,
            { id: vars.id, input: { ...vars.input, version: vars.version } },
          )
        : gqlRequest(
            `mutation($input: CreateCustomerInput!){ createCustomer(input:$input){ id } }`,
            { input: vars.input },
          ),
    [keys.customers],
  );

// ------------------------------------------------------------------- orders

export interface OrderFilter {
  search: string;
  status: SalesOrderStatus | '';
  page: number;
}

export const useOrders = (filter: OrderFilter, enabled = true) =>
  useQuery({
    enabled,
    queryKey: [...keys.orders, filter],
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await gqlRequest<{ salesOrders: { items: OrderSummary[]; total: number } }>(
          `query($input: ListSalesOrdersInput){ salesOrders(input:$input){ total items { ${ORDER} } } }`,
          {
            input: {
              search: filter.search || null,
              status: filter.status || null,
              limit: PAGE_SIZE,
              offset: filter.page * PAGE_SIZE,
            },
          },
        )
      ).salesOrders,
  });

export const useOrder = (id: string | null) =>
  useQuery({
    enabled: id !== null,
    queryKey: [...keys.order, id],
    queryFn: async () =>
      (
        await gqlRequest<{ salesOrder: OrderDetail }>(
          `query($id: ID!){ salesOrder(id:$id){ ${DETAIL} } }`,
          { id },
        )
      ).salesOrder,
  });

export const useSaveOrder = () =>
  useAction(
    async (vars: { id?: string; input: Record<string, unknown> }) =>
      vars.id
        ? gqlRequest<{ updateSalesOrder: { id: string } }>(
            `mutation($id: ID!, $input: UpdateSalesOrderInput!){ updateSalesOrder(id:$id,input:$input){ id } }`,
            { id: vars.id, input: vars.input },
          )
        : gqlRequest<{ createSalesOrder: { id: string } }>(
            `mutation($input: CreateSalesOrderInput!){ createSalesOrder(input:$input){ id } }`,
            { input: vars.input },
          ),
    [keys.orders, keys.order],
  );

export const useDecideOrder = () =>
  useAction(
    (vars: { id: string; version: number; decision: 'confirm' | 'cancel' }) =>
      vars.decision === 'confirm'
        ? gqlRequest(
            `mutation($id: ID!, $input: SalesDecisionInput!){ confirmSalesOrder(id:$id,input:$input){ id } }`,
            { id: vars.id, input: { version: vars.version } },
          )
        : gqlRequest(
            `mutation($id: ID!, $input: SalesDecisionInput!){ cancelSalesOrder(id:$id,input:$input){ id } }`,
            { id: vars.id, input: { version: vars.version } },
          ),
    [keys.orders, keys.order],
  );

export const useDeliverGoods = () =>
  useAction(
    (input: Record<string, unknown>) =>
      gqlRequest(`mutation($input: DeliverGoodsInput!){ deliverGoods(input:$input){ id } }`, {
        input,
      }),
    AFTER_RECEIPT,
  );
