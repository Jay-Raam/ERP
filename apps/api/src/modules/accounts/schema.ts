import type { GraphQLContext } from '../../graphql/context';
import type { AccountsService } from './accounts.service';

export const accountsTypeDefs = /* GraphQL */ `
  enum AccountType {
    asset
    liability
    equity
    income
    expense
  }

  enum InvoiceKind {
    sales
    purchase
  }

  enum InvoiceStatus {
    draft
    posted
    cancelled
  }

  enum PaymentMethod {
    cash
    bank
    upi
    cheque
    card
  }

  type Account {
    id: ID!
    code: String!
    name: String!
    type: AccountType!
    isSystem: Boolean!
    status: RecordStatus!
    version: Int!
  }

  input CreateAccountInput {
    code: String!
    name: String!
    type: AccountType!
  }

  input UpdateAccountInput {
    name: String!
    status: RecordStatus!
    version: Int!
  }

  type LedgerBranch {
    id: ID!
    code: String!
    name: String!
  }

  type LedgerAccountRef {
    id: ID!
    code: String!
    name: String!
  }

  "Money is a decimal string with two decimals."
  type JournalLine {
    account: LedgerAccountRef!
    debit: String!
    credit: String!
  }

  type JournalEntry {
    id: ID!
    number: String!
    entryDate: String!
    memo: String!
    sourceType: String!
    sourceId: ID
    reversalOf: ID
    reversedById: ID
    createdAt: String!
    createdByName: String!
    branch: LedgerBranch
    total: String!
  }

  type JournalEntryDetail {
    id: ID!
    number: String!
    entryDate: String!
    memo: String!
    sourceType: String!
    sourceId: ID
    reversalOf: ID
    reversedById: ID
    createdAt: String!
    createdByName: String!
    branch: LedgerBranch
    total: String!
    lines: [JournalLine!]!
  }

  type JournalPage {
    items: [JournalEntry!]!
    total: Int!
  }

  input JournalLineInput {
    accountId: ID!
    debit: String
    credit: String
  }

  input CreateJournalEntryInput {
    entryDate: String!
    memo: String!
    branchId: ID
    lines: [JournalLineInput!]!
  }

  input ReverseJournalInput {
    reason: String!
  }

  input ListJournalInput {
    from: String
    to: String
    accountId: ID
    search: String
    limit: Int
    offset: Int
  }

  type TrialRow {
    id: ID!
    code: String!
    name: String!
    type: AccountType!
    debit: String!
    credit: String!
    balance: String!
  }

  type TrialBalance {
    asOf: String!
    rows: [TrialRow!]!
    totalDebit: String!
    totalCredit: String!
    balanced: Boolean!
  }

  input TrialBalanceInput {
    asOf: String
  }

  type LedgerLine {
    entryId: ID!
    number: String!
    entryDate: String!
    memo: String!
    sourceType: String!
    debit: String!
    credit: String!
    balance: String!
  }

  type AccountLedger {
    account: Account!
    opening: String!
    total: Int!
    items: [LedgerLine!]!
  }

  input AccountLedgerInput {
    accountId: ID!
    from: String
    to: String
    limit: Int
    offset: Int
  }

  type AgeingRow {
    partyId: ID!
    partyName: String!
    current: String!
    days30: String!
    days60: String!
    days90: String!
    over90: String!
    total: String!
  }

  type AgeingTotals {
    current: String!
    days30: String!
    days60: String!
    days90: String!
    over90: String!
    total: String!
  }

  type Ageing {
    asOf: String!
    rows: [AgeingRow!]!
    totals: AgeingTotals!
  }

  input AgeingInput {
    kind: InvoiceKind!
  }

  type InvoiceParty {
    id: ID!
    code: String!
    name: String!
  }

  type InvoiceItem {
    id: ID!
    sku: String!
    name: String!
    unit: String!
  }

  type InvoiceLine {
    id: ID!
    item: InvoiceItem!
    quantity: String!
    unitPrice: String!
    gstRate: Int!
    subtotal: String!
    taxAmount: String!
    total: String!
  }

  type PaymentInvoiceRef {
    id: ID!
    number: String!
  }

  type Payment {
    id: ID!
    number: String!
    kind: InvoiceKind!
    amount: String!
    method: PaymentMethod!
    paidOn: String!
    reference: String
    createdAt: String!
    createdByName: String!
    voidedAt: String
    voidedByName: String
    voidReason: String
    journalEntryId: ID!
    invoice: PaymentInvoiceRef!
    partyName: String!
  }

  type PaymentPage {
    items: [Payment!]!
    total: Int!
  }

  type Invoice {
    id: ID!
    number: String!
    kind: InvoiceKind!
    status: InvoiceStatus!
    reference: String
    invoiceDate: String!
    dueDate: String!
    notes: String
    subtotal: String!
    taxTotal: String!
    grandTotal: String!
    paidAmount: String!
    outstanding: String!
    version: Int!
    createdAt: String!
    postedAt: String
    cancelledAt: String
    cancelReason: String
    createdByName: String!
    journalEntryId: ID
    party: InvoiceParty!
    branch: LedgerBranch!
    sourceNumber: String!
  }

  type InvoiceDetail {
    id: ID!
    number: String!
    kind: InvoiceKind!
    status: InvoiceStatus!
    reference: String
    invoiceDate: String!
    dueDate: String!
    notes: String
    subtotal: String!
    taxTotal: String!
    grandTotal: String!
    paidAmount: String!
    outstanding: String!
    version: Int!
    createdAt: String!
    postedAt: String
    cancelledAt: String
    cancelReason: String
    createdByName: String!
    journalEntryId: ID
    party: InvoiceParty!
    branch: LedgerBranch!
    sourceNumber: String!
    lines: [InvoiceLine!]!
    payments: [Payment!]!
  }

  type InvoicePage {
    items: [Invoice!]!
    total: Int!
  }

  input ListInvoicesInput {
    kind: InvoiceKind!
    search: String
    status: InvoiceStatus
    outstandingOnly: Boolean
    limit: Int
    offset: Int
  }

  input CreateInvoiceInput {
    kind: InvoiceKind!
    sourceId: ID!
    invoiceDate: String!
    dueDate: String
    reference: String
    notes: String
  }

  input UpdateInvoiceInput {
    invoiceDate: String!
    dueDate: String
    reference: String
    notes: String
    version: Int!
  }

  input PostInvoiceInput {
    version: Int!
  }

  input CancelInvoiceInput {
    version: Int!
    reason: String!
  }

  input RecordPaymentInput {
    invoiceId: ID!
    amount: String!
    method: PaymentMethod!
    paidOn: String!
    reference: String
  }

  input VoidPaymentInput {
    reason: String!
  }

  input ListPaymentsInput {
    kind: InvoiceKind
    invoiceId: ID
    limit: Int
    offset: Int
  }

  extend type Query {
    accounts: [Account!]!
    journalEntries(input: ListJournalInput): JournalPage!
    journalEntry(id: ID!): JournalEntryDetail!
    trialBalance(input: TrialBalanceInput): TrialBalance!
    accountLedger(input: AccountLedgerInput!): AccountLedger!
    ageing(input: AgeingInput!): Ageing!
    invoices(input: ListInvoicesInput!): InvoicePage!
    invoice(id: ID!): InvoiceDetail!
    payments(input: ListPaymentsInput): PaymentPage!
  }

  extend type Mutation {
    createAccount(input: CreateAccountInput!): Account!
    updateAccount(id: ID!, input: UpdateAccountInput!): Account!
    createJournalEntry(input: CreateJournalEntryInput!): JournalEntryDetail!
    reverseJournalEntry(id: ID!, input: ReverseJournalInput!): JournalEntryDetail!
    createInvoice(input: CreateInvoiceInput!): InvoiceDetail!
    updateInvoice(id: ID!, input: UpdateInvoiceInput!): InvoiceDetail!
    postInvoice(id: ID!, input: PostInvoiceInput!): InvoiceDetail!
    cancelInvoice(id: ID!, input: CancelInvoiceInput!): InvoiceDetail!
    recordPayment(input: RecordPaymentInput!): Payment!
    voidPayment(id: ID!, input: VoidPaymentInput!): Payment!
  }
`;

type Args<T> = { input: T };
type IdArgs<T> = { id: string; input: T };

const iso = (d: Date | null) => (d ? d.toISOString() : null);

type WithDates = { createdAt: Date; postedAt?: Date | null; cancelledAt?: Date | null };

const invoiceDates = <T extends WithDates>(i: T) => ({
  ...i,
  createdAt: i.createdAt.toISOString(),
  postedAt: iso(i.postedAt ?? null),
  cancelledAt: iso(i.cancelledAt ?? null),
});

type PaymentLike = { createdAt: Date; voidedAt: Date | null };
const paymentDates = <T extends PaymentLike>(p: T) => ({
  ...p,
  createdAt: p.createdAt.toISOString(),
  voidedAt: iso(p.voidedAt),
});

type InvoiceDetailData = Awaited<ReturnType<AccountsService['getInvoice']>>;
const shapeInvoice = (i: InvoiceDetailData) => ({
  ...invoiceDates(i),
  payments: i.payments.map(paymentDates),
});

const entryDates = <T extends { createdAt: Date }>(e: T) => ({
  ...e,
  createdAt: e.createdAt.toISOString(),
});

export function accountsResolvers(accounts: AccountsService) {
  return {
    Query: {
      accounts: async (_p: unknown, _a: unknown, ctx: GraphQLContext) =>
        accounts.listAccounts(await ctx.viewer()),
      journalEntries: async (_p: unknown, a: { input?: unknown }, ctx: GraphQLContext) => {
        const page = await accounts.listJournal(await ctx.viewer(), a.input);
        return { total: page.total, items: page.items.map(entryDates) };
      },
      journalEntry: async (_p: unknown, a: { id: string }, ctx: GraphQLContext) =>
        entryDates(await accounts.getJournalEntry(await ctx.viewer(), a.id)),
      trialBalance: async (_p: unknown, a: { input?: unknown }, ctx: GraphQLContext) =>
        accounts.trialBalance(await ctx.viewer(), a.input),
      accountLedger: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        accounts.accountLedger(await ctx.viewer(), a.input),
      ageing: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        accounts.ageing(await ctx.viewer(), a.input),
      invoices: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) => {
        const page = await accounts.listInvoices(await ctx.viewer(), a.input);
        return { total: page.total, items: page.items.map(invoiceDates) };
      },
      invoice: async (_p: unknown, a: { id: string }, ctx: GraphQLContext) =>
        shapeInvoice(await accounts.getInvoice(await ctx.viewer(), a.id)),
      payments: async (_p: unknown, a: { input?: unknown }, ctx: GraphQLContext) => {
        const page = await accounts.listPayments(await ctx.viewer(), a.input);
        return { total: page.total, items: page.items.map(paymentDates) };
      },
    },
    Mutation: {
      createAccount: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        accounts.createAccount(await ctx.viewer(), a.input),
      updateAccount: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        accounts.updateAccount(await ctx.viewer(), a.id, a.input),
      createJournalEntry: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        entryDates(await accounts.createJournalEntry(await ctx.viewer(), a.input)),
      reverseJournalEntry: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        entryDates(await accounts.reverseJournalEntry(await ctx.viewer(), a.id, a.input)),
      createInvoice: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        shapeInvoice(await accounts.createInvoice(await ctx.viewer(), a.input)),
      updateInvoice: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        shapeInvoice(await accounts.updateInvoice(await ctx.viewer(), a.id, a.input)),
      postInvoice: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        shapeInvoice(await accounts.postInvoice(await ctx.viewer(), a.id, a.input)),
      cancelInvoice: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        shapeInvoice(await accounts.cancelInvoice(await ctx.viewer(), a.id, a.input)),
      recordPayment: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        paymentDates(await accounts.recordPayment(await ctx.viewer(), a.input)),
      voidPayment: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        paymentDates(await accounts.voidPayment(await ctx.viewer(), a.id, a.input)),
    },
  };
}
