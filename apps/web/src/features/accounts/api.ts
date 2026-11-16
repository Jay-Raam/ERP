'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccountType, InvoiceKind, InvoiceStatus } from '@erp/shared';
import { gqlRequest } from '@/lib/api-client';

export const PAGE_SIZE = 20;

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  isSystem: boolean;
  status: 'active' | 'inactive';
  version: number;
}

export interface PaymentRow {
  id: string;
  number: string;
  kind: InvoiceKind;
  amount: string;
  method: string;
  paidOn: string;
  reference: string | null;
  createdAt: string;
  createdByName: string;
  voidedAt: string | null;
  voidedByName: string | null;
  voidReason: string | null;
  journalEntryId: string;
  invoice: { id: string; number: string };
  partyName: string;
}

export interface InvoiceSummary {
  id: string;
  number: string;
  kind: InvoiceKind;
  status: InvoiceStatus;
  reference: string | null;
  invoiceDate: string;
  dueDate: string;
  notes: string | null;
  subtotal: string;
  taxTotal: string;
  grandTotal: string;
  paidAmount: string;
  outstanding: string;
  version: number;
  createdAt: string;
  postedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdByName: string;
  journalEntryId: string | null;
  party: { id: string; code: string; name: string };
  branch: { id: string; code: string; name: string };
  sourceNumber: string;
}

export interface InvoiceDetail extends InvoiceSummary {
  lines: {
    id: string;
    quantity: string;
    unitPrice: string;
    gstRate: number;
    subtotal: string;
    taxAmount: string;
    total: string;
    item: { id: string; sku: string; name: string; unit: string };
  }[];
  payments: PaymentRow[];
}

export interface JournalEntry {
  id: string;
  number: string;
  entryDate: string;
  memo: string;
  sourceType: string;
  sourceId: string | null;
  reversalOf: string | null;
  reversedById: string | null;
  createdAt: string;
  createdByName: string;
  branch: { id: string; code: string; name: string } | null;
  total: string;
}

export interface JournalDetail extends JournalEntry {
  lines: { account: { id: string; code: string; name: string }; debit: string; credit: string }[];
}

const ACCOUNT = 'id code name type isSystem status version';
const PAYMENT = `id number kind amount method paidOn reference createdAt createdByName voidedAt voidedByName voidReason journalEntryId invoice { id number } partyName`;
const INVOICE = `id number kind status reference invoiceDate dueDate notes subtotal taxTotal grandTotal paidAmount outstanding version createdAt postedAt cancelledAt cancelReason createdByName journalEntryId sourceNumber party { id code name } branch { id code name }`;
const INVOICE_DETAIL = `${INVOICE}
  lines { id quantity unitPrice gstRate subtotal taxAmount total item { id sku name unit } }
  payments { ${PAYMENT} }`;
const ENTRY = `id number entryDate memo sourceType sourceId reversalOf reversedById createdAt createdByName total branch { id code name }`;

const keys = {
  accounts: ['accounts', 'chart'] as const,
  invoices: ['accounts', 'invoices'] as const,
  invoice: ['accounts', 'invoice'] as const,
  payments: ['accounts', 'payments'] as const,
  journal: ['accounts', 'journal'] as const,
  entry: ['accounts', 'entry'] as const,
  reports: ['accounts', 'report'] as const,
};
/** Anything that posts or voids changes every figure at once. */
const EVERYTHING = [
  keys.invoices,
  keys.invoice,
  keys.payments,
  keys.journal,
  keys.entry,
  keys.reports,
];

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

// ------------------------------------------------------------------ accounts

export const useAccounts = (enabled = true) =>
  useQuery({
    enabled,
    queryKey: keys.accounts,
    queryFn: async () =>
      (await gqlRequest<{ accounts: Account[] }>(`query{ accounts { ${ACCOUNT} } }`)).accounts,
  });

export const useSaveAccount = () =>
  useAction(
    (vars: { id?: string; version?: number; input: Record<string, unknown> }) =>
      vars.id
        ? gqlRequest(
            `mutation($id: ID!, $input: UpdateAccountInput!){ updateAccount(id:$id,input:$input){ id } }`,
            { id: vars.id, input: { ...vars.input, version: vars.version } },
          )
        : gqlRequest(`mutation($input: CreateAccountInput!){ createAccount(input:$input){ id } }`, {
            input: vars.input,
          }),
    [keys.accounts, keys.reports],
  );

// ------------------------------------------------------------------ invoices

export interface InvoiceFilter {
  kind: InvoiceKind;
  search: string;
  status: InvoiceStatus | '';
  outstandingOnly: boolean;
  page: number;
}

export const useInvoices = (filter: InvoiceFilter, enabled = true) =>
  useQuery({
    enabled,
    queryKey: [...keys.invoices, filter],
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await gqlRequest<{ invoices: { items: InvoiceSummary[]; total: number } }>(
          `query($input: ListInvoicesInput!){ invoices(input:$input){ total items { ${INVOICE} } } }`,
          {
            input: {
              kind: filter.kind,
              search: filter.search || null,
              status: filter.status || null,
              outstandingOnly: filter.outstandingOnly,
              limit: PAGE_SIZE,
              offset: filter.page * PAGE_SIZE,
            },
          },
        )
      ).invoices,
  });

export const useInvoice = (id: string | null) =>
  useQuery({
    enabled: id !== null,
    queryKey: [...keys.invoice, id],
    queryFn: async () =>
      (
        await gqlRequest<{ invoice: InvoiceDetail }>(
          `query($id: ID!){ invoice(id:$id){ ${INVOICE_DETAIL} } }`,
          { id },
        )
      ).invoice,
  });

export const useCreateInvoice = () =>
  useAction(
    (input: Record<string, unknown>) =>
      gqlRequest<{ createInvoice: { id: string; number: string } }>(
        `mutation($input: CreateInvoiceInput!){ createInvoice(input:$input){ id number } }`,
        { input },
      ),
    [keys.invoices],
  );

export const useUpdateInvoice = () =>
  useAction(
    (vars: { id: string; input: Record<string, unknown> }) =>
      gqlRequest(
        `mutation($id: ID!, $input: UpdateInvoiceInput!){ updateInvoice(id:$id,input:$input){ id } }`,
        vars,
      ),
    [keys.invoices, keys.invoice],
  );

export const usePostInvoice = () =>
  useAction(
    (vars: { id: string; version: number }) =>
      gqlRequest(
        `mutation($id: ID!, $input: PostInvoiceInput!){ postInvoice(id:$id,input:$input){ id } }`,
        { id: vars.id, input: { version: vars.version } },
      ),
    EVERYTHING,
  );

export const useCancelInvoice = () =>
  useAction(
    (vars: { id: string; version: number; reason: string }) =>
      gqlRequest(
        `mutation($id: ID!, $input: CancelInvoiceInput!){ cancelInvoice(id:$id,input:$input){ id } }`,
        { id: vars.id, input: { version: vars.version, reason: vars.reason } },
      ),
    EVERYTHING,
  );

// ------------------------------------------------------------------ payments

export const useRecordPayment = () =>
  useAction(
    (input: Record<string, unknown>) =>
      gqlRequest(`mutation($input: RecordPaymentInput!){ recordPayment(input:$input){ id } }`, {
        input,
      }),
    EVERYTHING,
  );

export const useVoidPayment = () =>
  useAction(
    (vars: { id: string; reason: string }) =>
      gqlRequest(
        `mutation($id: ID!, $input: VoidPaymentInput!){ voidPayment(id:$id,input:$input){ id } }`,
        { id: vars.id, input: { reason: vars.reason } },
      ),
    EVERYTHING,
  );

export interface PaymentFilter {
  kind: InvoiceKind | '';
  page: number;
}

export const usePayments = (filter: PaymentFilter, enabled = true) =>
  useQuery({
    enabled,
    queryKey: [...keys.payments, filter],
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await gqlRequest<{ payments: { items: PaymentRow[]; total: number } }>(
          `query($input: ListPaymentsInput){ payments(input:$input){ total items { ${PAYMENT} } } }`,
          {
            input: {
              kind: filter.kind || null,
              limit: PAGE_SIZE,
              offset: filter.page * PAGE_SIZE,
            },
          },
        )
      ).payments,
  });

// ------------------------------------------------------------------- journal

export interface JournalFilter {
  search: string;
  from: string;
  to: string;
  page: number;
}

export const useJournal = (filter: JournalFilter, enabled = true) =>
  useQuery({
    enabled,
    queryKey: [...keys.journal, filter],
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await gqlRequest<{ journalEntries: { items: JournalEntry[]; total: number } }>(
          `query($input: ListJournalInput){ journalEntries(input:$input){ total items { ${ENTRY} } } }`,
          {
            input: {
              search: filter.search || null,
              from: filter.from || null,
              to: filter.to || null,
              limit: PAGE_SIZE,
              offset: filter.page * PAGE_SIZE,
            },
          },
        )
      ).journalEntries,
  });

export const useJournalEntry = (id: string | null) =>
  useQuery({
    enabled: id !== null,
    queryKey: [...keys.entry, id],
    queryFn: async () =>
      (
        await gqlRequest<{ journalEntry: JournalDetail }>(
          `query($id: ID!){ journalEntry(id:$id){ ${ENTRY} lines { account { id code name } debit credit } } }`,
          { id },
        )
      ).journalEntry,
  });

export const useCreateEntry = () =>
  useAction(
    (input: Record<string, unknown>) =>
      gqlRequest(
        `mutation($input: CreateJournalEntryInput!){ createJournalEntry(input:$input){ id } }`,
        { input },
      ),
    [keys.journal, keys.reports],
  );

export const useReverseEntry = () =>
  useAction(
    (vars: { id: string; reason: string }) =>
      gqlRequest(
        `mutation($id: ID!, $input: ReverseJournalInput!){ reverseJournalEntry(id:$id,input:$input){ id } }`,
        { id: vars.id, input: { reason: vars.reason } },
      ),
    [keys.journal, keys.entry, keys.reports],
  );

// ------------------------------------------------------------------- reports

export interface TrialBalance {
  asOf: string;
  totalDebit: string;
  totalCredit: string;
  balanced: boolean;
  rows: {
    id: string;
    code: string;
    name: string;
    type: AccountType;
    debit: string;
    credit: string;
    balance: string;
  }[];
}

export const useTrialBalance = (asOf: string) =>
  useQuery({
    queryKey: [...keys.reports, 'trial', asOf],
    queryFn: async () =>
      (
        await gqlRequest<{ trialBalance: TrialBalance }>(
          `query($input: TrialBalanceInput){ trialBalance(input:$input){ asOf totalDebit totalCredit balanced rows { id code name type debit credit balance } } }`,
          { input: { asOf: asOf || null } },
        )
      ).trialBalance,
  });

export interface AgeingReport {
  asOf: string;
  rows: {
    partyId: string;
    partyName: string;
    current: string;
    days30: string;
    days60: string;
    days90: string;
    over90: string;
    total: string;
  }[];
  totals: {
    current: string;
    days30: string;
    days60: string;
    days90: string;
    over90: string;
    total: string;
  };
}

export const useAgeing = (kind: InvoiceKind) =>
  useQuery({
    queryKey: [...keys.reports, 'ageing', kind],
    queryFn: async () =>
      (
        await gqlRequest<{ ageing: AgeingReport }>(
          `query($input: AgeingInput!){ ageing(input:$input){ asOf rows { partyId partyName current days30 days60 days90 over90 total } totals { current days30 days60 days90 over90 total } } }`,
          { input: { kind } },
        )
      ).ageing,
  });

export interface Ledger {
  account: Account;
  opening: string;
  total: number;
  items: {
    entryId: string;
    number: string;
    entryDate: string;
    memo: string;
    sourceType: string;
    debit: string;
    credit: string;
    balance: string;
  }[];
}

export interface LedgerFilter {
  accountId: string;
  from: string;
  to: string;
  page: number;
}

export const useLedger = (filter: LedgerFilter) =>
  useQuery({
    enabled: filter.accountId !== '',
    queryKey: [...keys.reports, 'ledger', filter],
    placeholderData: (previous) => previous,
    queryFn: async () =>
      (
        await gqlRequest<{ accountLedger: Ledger }>(
          `query($input: AccountLedgerInput!){ accountLedger(input:$input){ opening total account { ${ACCOUNT} } items { entryId number entryDate memo sourceType debit credit balance } } }`,
          {
            input: {
              accountId: filter.accountId,
              from: filter.from || null,
              to: filter.to || null,
              limit: PAGE_SIZE,
              offset: filter.page * PAGE_SIZE,
            },
          },
        )
      ).accountLedger,
  });
