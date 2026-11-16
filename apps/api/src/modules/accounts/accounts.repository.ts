import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { AccountType, InvoiceKind, InvoiceStatus } from '@erp/shared';
import type { TenantTx } from '../../db/client';
import {
  accounts,
  branches,
  customers,
  deliveries,
  deliveryLines,
  goodsReceiptLines,
  goodsReceipts,
  invoiceLines,
  invoices,
  journalEntries,
  journalLines,
  payments,
  purchaseOrderLines,
  purchaseOrders,
  salesOrderLines,
  salesOrders,
  suppliers,
  users,
} from '../../db/schema';
import type { Scope } from '../hr/scope';
import { likePattern } from '../hr/employees.repository';

export { nextNumber } from '../purchase/purchase.repository';

// ------------------------------------------------------------------ accounts

export type AccountRow = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  isSystem: boolean;
  status: 'active' | 'inactive';
  version: number;
};

const accountColumns = {
  id: accounts.id,
  code: accounts.code,
  name: accounts.name,
  type: accounts.type,
  isSystem: accounts.isSystem,
  status: accounts.status,
  version: accounts.version,
};

export async function listAccounts(tx: TenantTx): Promise<AccountRow[]> {
  return tx.select(accountColumns).from(accounts).orderBy(asc(accounts.code));
}

export async function findAccount(tx: TenantTx, id: string): Promise<AccountRow | null> {
  const [row] = await tx.select(accountColumns).from(accounts).where(eq(accounts.id, id)).limit(1);
  return row ?? null;
}

export async function insertAccount(
  tx: TenantTx,
  values: { tenantId: string; code: string; name: string; type: AccountType },
): Promise<string> {
  const [row] = await tx.insert(accounts).values(values).returning({ id: accounts.id });
  return row!.id;
}

/** Returns false when the version is stale. */
export async function updateAccount(
  tx: TenantTx,
  id: string,
  version: number,
  values: { name: string; status: 'active' | 'inactive' },
): Promise<boolean> {
  const rows = await tx
    .update(accounts)
    .set({ ...values, version: sql`${accounts.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(accounts.id, id), eq(accounts.version, version)))
    .returning({ id: accounts.id });
  return rows.length > 0;
}

// ------------------------------------------------------------------- journal

/** Entries belong to a branch (or to the whole organisation when branch is empty). */
function entryScope(scope: Scope, userId: string): SQL | undefined {
  switch (scope.kind) {
    case 'organisation':
      return undefined;
    case 'branch':
      return scope.branchIds.length > 0
        ? sql`${journalEntries.branchId} in (${sql.join(
            scope.branchIds.map((b) => sql`${b}`),
            sql`, `,
          )})`
        : sql`false`;
    case 'own':
      return eq(journalEntries.createdBy, userId);
  }
}

export async function insertEntry(
  tx: TenantTx,
  values: {
    tenantId: string;
    number: string;
    entryDate: string;
    memo: string;
    sourceType: 'invoice' | 'payment' | 'manual' | 'reversal' | 'payroll';
    sourceId: string | null;
    branchId: string | null;
    reversalOf: string | null;
    createdBy: string;
  },
): Promise<string> {
  const [row] = await tx.insert(journalEntries).values(values).returning({ id: journalEntries.id });
  return row!.id;
}

export async function insertJournalLines(
  tx: TenantTx,
  tenantId: string,
  entryId: string,
  lines: { accountId: string; debit: string; credit: string }[],
): Promise<void> {
  await tx.insert(journalLines).values(lines.map((l) => ({ ...l, tenantId, entryId })));
}

const entryCreator = alias(users, 'entry_creator');

export type EntryRow = {
  id: string;
  number: string;
  entryDate: string;
  memo: string;
  sourceType: string;
  sourceId: string | null;
  reversalOf: string | null;
  reversedById: string | null;
  createdAt: Date;
  createdByName: string;
  branch: { id: string; code: string; name: string } | null;
  total: string;
};

const entryBase = (tx: TenantTx) =>
  tx
    .select({
      id: journalEntries.id,
      number: journalEntries.number,
      entryDate: journalEntries.entryDate,
      memo: journalEntries.memo,
      sourceType: journalEntries.sourceType,
      sourceId: journalEntries.sourceId,
      reversalOf: journalEntries.reversalOf,
      createdAt: journalEntries.createdAt,
      createdByName: entryCreator.fullName,
      branchId: branches.id,
      branchCode: branches.code,
      branchName: branches.name,
      total: sql<string>`(select coalesce(sum(l.debit), 0)::numeric(18,2)::text from journal_lines l where l.entry_id = ${journalEntries.id})`,
      reversedById: sql<
        string | null
      >`(select r.id from journal_entries r where r.reversal_of = ${journalEntries.id} limit 1)`,
    })
    .from(journalEntries)
    .innerJoin(entryCreator, eq(entryCreator.id, journalEntries.createdBy))
    .leftJoin(branches, eq(branches.id, journalEntries.branchId));

type EntryJoined = Awaited<ReturnType<typeof entryBase>>[number];

const shapeEntry = (r: EntryJoined): EntryRow => ({
  id: r.id,
  number: r.number,
  entryDate: r.entryDate,
  memo: r.memo,
  sourceType: r.sourceType,
  sourceId: r.sourceId,
  reversalOf: r.reversalOf,
  reversedById: r.reversedById,
  createdAt: r.createdAt,
  createdByName: r.createdByName,
  branch: r.branchId ? { id: r.branchId, code: r.branchCode!, name: r.branchName! } : null,
  total: r.total,
});

export async function listEntries(
  tx: TenantTx,
  filter: {
    scope: Scope;
    userId: string;
    from?: string;
    to?: string;
    accountId?: string;
    search?: string;
    limit: number;
    offset: number;
  },
) {
  const where = and(
    entryScope(filter.scope, filter.userId),
    filter.from ? sql`${journalEntries.entryDate} >= ${filter.from}` : undefined,
    filter.to ? sql`${journalEntries.entryDate} <= ${filter.to}` : undefined,
    filter.accountId
      ? sql`exists (select 1 from journal_lines l where l.entry_id = ${journalEntries.id} and l.account_id = ${filter.accountId})`
      : undefined,
    filter.search
      ? or(
          ilike(journalEntries.number, likePattern(filter.search)),
          ilike(journalEntries.memo, likePattern(filter.search)),
        )
      : undefined,
  );
  const rows = await entryBase(tx)
    .where(where)
    .orderBy(
      desc(journalEntries.entryDate),
      desc(journalEntries.createdAt),
      desc(journalEntries.id),
    )
    .limit(filter.limit)
    .offset(filter.offset);
  const [count] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(journalEntries)
    .where(where);
  return { items: rows.map(shapeEntry), total: count!.n };
}

export async function findEntry(tx: TenantTx, id: string) {
  const [row] = await entryBase(tx).where(eq(journalEntries.id, id)).limit(1);
  return row ? shapeEntry(row) : null;
}

/** The raw scope facts of one entry, for visibility checks. */
export async function entryOwnership(tx: TenantTx, id: string) {
  const [row] = await tx
    .select({
      branchId: journalEntries.branchId,
      createdBy: journalEntries.createdBy,
      sourceType: journalEntries.sourceType,
      number: journalEntries.number,
      entryDate: journalEntries.entryDate,
      memo: journalEntries.memo,
    })
    .from(journalEntries)
    .where(eq(journalEntries.id, id))
    .limit(1);
  return row ?? null;
}

export async function entryLines(tx: TenantTx, entryId: string) {
  const rows = await tx
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(eq(journalLines.entryId, entryId))
    .orderBy(desc(journalLines.debit), asc(accounts.code), asc(journalLines.id));
  return rows.map((r) => ({
    account: { id: r.accountId, code: r.code, name: r.name },
    debit: r.debit,
    credit: r.credit,
  }));
}

// ------------------------------------------------------------------- reports

const scopeSql = (scope: Scope, userId: string): SQL => {
  switch (scope.kind) {
    case 'organisation':
      return sql`true`;
    case 'branch':
      return scope.branchIds.length > 0
        ? sql`e.branch_id in (${sql.join(
            scope.branchIds.map((b) => sql`${b}`),
            sql`, `,
          )})`
        : sql`false`;
    case 'own':
      return sql`e.created_by = ${userId}`;
  }
};

export type TrialRow = {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  debit: string;
  credit: string;
};

export async function trialBalance(
  tx: TenantTx,
  scope: Scope,
  userId: string,
  asOf: string,
): Promise<TrialRow[]> {
  const rows = await tx.execute<TrialRow>(sql`
    select a.id, a.code, a.name, a.type,
           coalesce(sum(l.debit), 0)::numeric(18,2)::text as debit,
           coalesce(sum(l.credit), 0)::numeric(18,2)::text as credit
    from accounts a
    left join (
      select jl.account_id, jl.debit, jl.credit
      from journal_lines jl
      join journal_entries e on e.id = jl.entry_id
      where e.entry_date <= ${asOf}::date and ${scopeSql(scope, userId)}
    ) l on l.account_id = a.id
    group by a.id
    order by a.code`);
  return [...rows];
}

export type LedgerRow = {
  entryId: string;
  number: string;
  entryDate: string;
  memo: string;
  sourceType: string;
  debit: string;
  credit: string;
  /** Running balance as debit minus credit, across everything up to this line. */
  running: string;
};

export async function accountLedger(
  tx: TenantTx,
  filter: {
    scope: Scope;
    userId: string;
    accountId: string;
    from?: string;
    to?: string;
    limit: number;
    offset: number;
  },
) {
  const from = filter.from ?? '0001-01-01';
  const to = filter.to ?? '9999-12-31';
  const base = sql`
    select e.id as entry_id, e.number, e.entry_date::text as entry_date, e.memo, e.source_type,
           l.debit, l.credit,
           sum(l.debit - l.credit) over (order by e.entry_date, e.created_at, l.id) as running
    from journal_lines l
    join journal_entries e on e.id = l.entry_id
    where l.account_id = ${filter.accountId}
      and e.entry_date <= ${to}::date
      and ${scopeSql(filter.scope, filter.userId)}`;
  const rows = await tx.execute<{
    entry_id: string;
    number: string;
    entry_date: string;
    memo: string;
    source_type: string;
    debit: string;
    credit: string;
    running: string;
  }>(sql`
    select * from (${base}) t
    where t.entry_date >= ${from}
    order by t.entry_date, t.number, t.running
    limit ${filter.limit} offset ${filter.offset}`);
  const [counts] = await tx.execute<{ n: number; opening: string }>(sql`
    select (select count(*)::int from (${base}) t where t.entry_date >= ${from}) as n,
           (select coalesce(sum(l.debit - l.credit), 0)::numeric(18,2)::text
              from journal_lines l join journal_entries e on e.id = l.entry_id
              where l.account_id = ${filter.accountId}
                and e.entry_date < ${from}::date
                and ${scopeSql(filter.scope, filter.userId)}) as opening`);
  return {
    items: rows.map<LedgerRow>((r) => ({
      entryId: r.entry_id,
      number: r.number,
      entryDate: r.entry_date,
      memo: r.memo,
      sourceType: r.source_type,
      debit: r.debit,
      credit: r.credit,
      running: r.running,
    })),
    total: counts!.n,
    opening: counts!.opening,
  };
}

export type AgeingRow = {
  partyId: string;
  partyName: string;
  current: string;
  days30: string;
  days60: string;
  days90: string;
  over90: string;
  total: string;
};

/** What is still owed, by how long it is overdue (days past the due date). */
export async function ageing(
  tx: TenantTx,
  filter: { kind: InvoiceKind; scope: Scope; today: string },
): Promise<AgeingRow[]> {
  const branchScope =
    filter.scope.kind === 'organisation'
      ? sql`true`
      : filter.scope.kind === 'branch'
        ? filter.scope.branchIds.length > 0
          ? sql`i.branch_id in (${sql.join(
              filter.scope.branchIds.map((b) => sql`${b}`),
              sql`, `,
            )})`
          : sql`false`
        : sql`false`;
  const party =
    filter.kind === 'sales'
      ? sql`join customers p on p.id = i.customer_id`
      : sql`join suppliers p on p.id = i.supplier_id`;
  const rows = await tx.execute<{
    party_id: string;
    party_name: string;
    current: string;
    days30: string;
    days60: string;
    days90: string;
    over90: string;
    total: string;
  }>(sql`
    with open as (
      select p.id as party_id, p.name as party_name,
             (i.grand_total - i.paid_amount) as owed,
             (${filter.today}::date - i.due_date) as late
      from invoices i ${party}
      where i.kind = ${filter.kind}::invoice_kind and i.status = 'posted'
        and i.grand_total > i.paid_amount and ${branchScope}
    )
    select party_id, party_name,
      coalesce(sum(owed) filter (where late <= 0), 0)::numeric(18,2)::text as current,
      coalesce(sum(owed) filter (where late between 1 and 30), 0)::numeric(18,2)::text as days30,
      coalesce(sum(owed) filter (where late between 31 and 60), 0)::numeric(18,2)::text as days60,
      coalesce(sum(owed) filter (where late between 61 and 90), 0)::numeric(18,2)::text as days90,
      coalesce(sum(owed) filter (where late > 90), 0)::numeric(18,2)::text as over90,
      sum(owed)::numeric(18,2)::text as total
    from open group by party_id, party_name order by party_name`);
  return rows.map((r) => ({
    partyId: r.party_id,
    partyName: r.party_name,
    current: r.current,
    days30: r.days30,
    days60: r.days60,
    days90: r.days90,
    over90: r.over90,
    total: r.total,
  }));
}

// ------------------------------------------------------------------ invoices

function invoiceScope(scope: Scope, userId: string): SQL | undefined {
  switch (scope.kind) {
    case 'organisation':
      return undefined;
    case 'branch':
      return scope.branchIds.length > 0
        ? sql`${invoices.branchId} in (${sql.join(
            scope.branchIds.map((b) => sql`${b}`),
            sql`, `,
          )})`
        : sql`false`;
    case 'own':
      return eq(invoices.createdBy, userId);
  }
}

const invoiceCreator = alias(users, 'invoice_creator');
const salesDelivery = alias(deliveries, 'sales_delivery');
const receiptHead = alias(goodsReceipts, 'receipt_head');

export type InvoiceRow = {
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
  createdAt: Date;
  postedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdBy: string;
  createdByName: string;
  journalEntryId: string | null;
  party: { id: string; code: string; name: string };
  branch: { id: string; code: string; name: string };
  sourceNumber: string;
};

const invoiceBase = (tx: TenantTx) =>
  tx
    .select({
      id: invoices.id,
      number: invoices.number,
      kind: invoices.kind,
      status: invoices.status,
      reference: invoices.reference,
      invoiceDate: invoices.invoiceDate,
      dueDate: invoices.dueDate,
      notes: invoices.notes,
      subtotal: invoices.subtotal,
      taxTotal: invoices.taxTotal,
      grandTotal: invoices.grandTotal,
      paidAmount: invoices.paidAmount,
      outstanding: sql<string>`(${invoices.grandTotal} - ${invoices.paidAmount})::numeric(18,2)::text`,
      version: invoices.version,
      createdAt: invoices.createdAt,
      postedAt: invoices.postedAt,
      cancelledAt: invoices.cancelledAt,
      cancelReason: invoices.cancelReason,
      createdBy: invoices.createdBy,
      createdByName: invoiceCreator.fullName,
      journalEntryId: invoices.journalEntryId,
      branchId: branches.id,
      branchCode: branches.code,
      branchName: branches.name,
      customerId: customers.id,
      customerCode: customers.code,
      customerName: customers.name,
      supplierId: suppliers.id,
      supplierCode: suppliers.code,
      supplierName: suppliers.name,
      deliveryNumber: salesDelivery.number,
      receiptNumber: receiptHead.number,
    })
    .from(invoices)
    .innerJoin(invoiceCreator, eq(invoiceCreator.id, invoices.createdBy))
    .innerJoin(branches, eq(branches.id, invoices.branchId))
    .leftJoin(customers, eq(customers.id, invoices.customerId))
    .leftJoin(suppliers, eq(suppliers.id, invoices.supplierId))
    .leftJoin(salesDelivery, eq(salesDelivery.id, invoices.deliveryId))
    .leftJoin(receiptHead, eq(receiptHead.id, invoices.receiptId));

type InvoiceJoined = Awaited<ReturnType<typeof invoiceBase>>[number];

const shapeInvoice = (r: InvoiceJoined): InvoiceRow => ({
  id: r.id,
  number: r.number,
  kind: r.kind,
  status: r.status,
  reference: r.reference,
  invoiceDate: r.invoiceDate,
  dueDate: r.dueDate,
  notes: r.notes,
  subtotal: r.subtotal,
  taxTotal: r.taxTotal,
  grandTotal: r.grandTotal,
  paidAmount: r.paidAmount,
  outstanding: r.outstanding,
  version: r.version,
  createdAt: r.createdAt,
  postedAt: r.postedAt,
  cancelledAt: r.cancelledAt,
  cancelReason: r.cancelReason,
  createdBy: r.createdBy,
  createdByName: r.createdByName,
  journalEntryId: r.journalEntryId,
  party:
    r.kind === 'sales'
      ? { id: r.customerId!, code: r.customerCode!, name: r.customerName! }
      : { id: r.supplierId!, code: r.supplierCode!, name: r.supplierName! },
  branch: { id: r.branchId, code: r.branchCode, name: r.branchName },
  sourceNumber: (r.kind === 'sales' ? r.deliveryNumber : r.receiptNumber) ?? '',
});

export async function listInvoices(
  tx: TenantTx,
  filter: {
    scope: Scope;
    userId: string;
    kind: InvoiceKind;
    search?: string;
    status?: InvoiceStatus;
    outstandingOnly: boolean;
    limit: number;
    offset: number;
  },
) {
  const where = and(
    eq(invoices.kind, filter.kind),
    invoiceScope(filter.scope, filter.userId),
    filter.status ? eq(invoices.status, filter.status) : undefined,
    filter.outstandingOnly
      ? sql`${invoices.status} = 'posted' and ${invoices.grandTotal} > ${invoices.paidAmount}`
      : undefined,
    filter.search
      ? or(
          ilike(invoices.number, likePattern(filter.search)),
          ilike(invoices.reference, likePattern(filter.search)),
          filter.kind === 'sales'
            ? sql`${invoices.customerId} in (select c.id from customers c where c.name ilike ${likePattern(filter.search)})`
            : sql`${invoices.supplierId} in (select s.id from suppliers s where s.name ilike ${likePattern(filter.search)})`,
        )
      : undefined,
  );
  const rows = await invoiceBase(tx)
    .where(where)
    .orderBy(desc(invoices.createdAt), desc(invoices.id))
    .limit(filter.limit)
    .offset(filter.offset);
  const [count] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(invoices)
    .where(where);
  return { items: rows.map(shapeInvoice), total: count!.n };
}

export async function findInvoice(tx: TenantTx, id: string): Promise<InvoiceRow | null> {
  const [row] = await invoiceBase(tx).where(eq(invoices.id, id)).limit(1);
  return row ? shapeInvoice(row) : null;
}

/** Locks the invoice row so posting, paying and cancelling queue up. */
export async function lockInvoice(tx: TenantTx, id: string) {
  const [row] = await tx
    .select({
      id: invoices.id,
      kind: invoices.kind,
      status: invoices.status,
      version: invoices.version,
      branchId: invoices.branchId,
      createdBy: invoices.createdBy,
      number: invoices.number,
      invoiceDate: invoices.invoiceDate,
      subtotal: invoices.subtotal,
      taxTotal: invoices.taxTotal,
      grandTotal: invoices.grandTotal,
      paidAmount: invoices.paidAmount,
      journalEntryId: invoices.journalEntryId,
    })
    .from(invoices)
    .where(eq(invoices.id, id))
    .for('update')
    .limit(1);
  return row ?? null;
}

export async function insertInvoice(
  tx: TenantTx,
  values: {
    tenantId: string;
    number: string;
    kind: InvoiceKind;
    branchId: string;
    customerId: string | null;
    supplierId: string | null;
    deliveryId: string | null;
    receiptId: string | null;
    reference: string | null;
    invoiceDate: string;
    dueDate: string;
    notes: string | null;
    subtotal: string;
    taxTotal: string;
    grandTotal: string;
    createdBy: string;
  },
): Promise<string> {
  const [row] = await tx.insert(invoices).values(values).returning({ id: invoices.id });
  return row!.id;
}

export async function insertInvoiceLines(
  tx: TenantTx,
  tenantId: string,
  invoiceId: string,
  lines: {
    itemId: string;
    quantity: string;
    unitPrice: string;
    gstRate: number;
    subtotal: string;
    taxAmount: string;
    total: string;
  }[],
): Promise<void> {
  await tx.insert(invoiceLines).values(lines.map((l) => ({ ...l, tenantId, invoiceId })));
}

export async function listInvoiceLines(tx: TenantTx, invoiceId: string) {
  const rows = await tx
    .select({
      id: invoiceLines.id,
      quantity: invoiceLines.quantity,
      unitPrice: invoiceLines.unitPrice,
      gstRate: invoiceLines.gstRate,
      subtotal: invoiceLines.subtotal,
      taxAmount: invoiceLines.taxAmount,
      total: invoiceLines.total,
      itemId: sql<string>`i.id`,
      sku: sql<string>`i.sku`,
      name: sql<string>`i.name`,
      unit: sql<string>`i.unit`,
    })
    .from(invoiceLines)
    .innerJoin(sql`items i`, sql`i.id = ${invoiceLines.itemId}`)
    .where(eq(invoiceLines.invoiceId, invoiceId))
    .orderBy(asc(sql`i.name`), asc(invoiceLines.id));
  return rows.map((r) => ({
    id: r.id,
    quantity: r.quantity,
    unitPrice: r.unitPrice,
    gstRate: r.gstRate,
    subtotal: r.subtotal,
    taxAmount: r.taxAmount,
    total: r.total,
    item: { id: r.itemId, sku: r.sku, name: r.name, unit: r.unit },
  }));
}

/** Draft edit. Returns false when the version is stale or the invoice is no longer a draft. */
export async function updateDraftInvoice(
  tx: TenantTx,
  id: string,
  version: number,
  values: {
    invoiceDate: string;
    dueDate: string;
    reference: string | null;
    notes: string | null;
  },
): Promise<boolean> {
  const rows = await tx
    .update(invoices)
    .set({ ...values, version: sql`${invoices.version} + 1`, updatedAt: sql`now()` })
    .where(and(eq(invoices.id, id), eq(invoices.version, version), eq(invoices.status, 'draft')))
    .returning({ id: invoices.id });
  return rows.length > 0;
}

export async function setInvoiceState(
  tx: TenantTx,
  id: string,
  values: {
    status: InvoiceStatus;
    journalEntryId?: string;
    postedBy?: string;
    postedAt?: Date;
    cancelledAt?: Date;
    cancelReason?: string;
  },
): Promise<void> {
  await tx
    .update(invoices)
    .set({ ...values, version: sql`${invoices.version} + 1`, updatedAt: sql`now()` })
    .where(eq(invoices.id, id));
}

/** Guarded: refuses to pay more than the grand total. Returns false when it would. */
export async function addPaid(tx: TenantTx, id: string, amount: string): Promise<boolean> {
  const rows = await tx
    .update(invoices)
    .set({
      paidAmount: sql`${invoices.paidAmount} + ${amount}::numeric`,
      version: sql`${invoices.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(invoices.id, id),
        eq(invoices.status, 'posted'),
        sql`${invoices.paidAmount} + ${amount}::numeric <= ${invoices.grandTotal}`,
      ),
    )
    .returning({ id: invoices.id });
  return rows.length > 0;
}

export async function subtractPaid(tx: TenantTx, id: string, amount: string): Promise<boolean> {
  const rows = await tx
    .update(invoices)
    .set({
      paidAmount: sql`${invoices.paidAmount} - ${amount}::numeric`,
      version: sql`${invoices.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(invoices.id, id), sql`${invoices.paidAmount} - ${amount}::numeric >= 0`))
    .returning({ id: invoices.id });
  return rows.length > 0;
}

// ---------------------------------------------------------- invoice sources

export type SourceLine = {
  itemId: string;
  quantity: string;
  unitPrice: string;
  gstRate: number;
};

export type Source = {
  id: string;
  number: string;
  reference: string | null;
  branchId: string;
  orderCreatedBy: string;
  partyId: string;
  partyStatus: 'active' | 'inactive';
  lines: SourceLine[];
};

/** A delivery with the prices of the order it belongs to. */
export async function findDeliverySource(tx: TenantTx, id: string): Promise<Source | null> {
  const [head] = await tx
    .select({
      id: deliveries.id,
      number: deliveries.number,
      reference: deliveries.reference,
      branchId: salesOrders.branchId,
      orderCreatedBy: salesOrders.createdBy,
      partyId: salesOrders.customerId,
      partyStatus: customers.status,
    })
    .from(deliveries)
    .innerJoin(salesOrders, eq(salesOrders.id, deliveries.orderId))
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(eq(deliveries.id, id))
    .limit(1);
  if (!head) return null;
  const lines = await tx
    .select({
      itemId: deliveryLines.itemId,
      quantity: deliveryLines.quantity,
      unitPrice: salesOrderLines.unitPrice,
      gstRate: salesOrderLines.gstRate,
    })
    .from(deliveryLines)
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, deliveryLines.orderLineId))
    .where(eq(deliveryLines.deliveryId, id))
    .orderBy(asc(deliveryLines.id));
  return { ...head, lines };
}

/** A goods receipt with the prices of the purchase order it belongs to. */
export async function findReceiptSource(tx: TenantTx, id: string): Promise<Source | null> {
  const [head] = await tx
    .select({
      id: goodsReceipts.id,
      number: goodsReceipts.number,
      reference: goodsReceipts.supplierInvoiceNo,
      branchId: purchaseOrders.branchId,
      orderCreatedBy: purchaseOrders.createdBy,
      partyId: purchaseOrders.supplierId,
      partyStatus: suppliers.status,
    })
    .from(goodsReceipts)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, goodsReceipts.orderId))
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(eq(goodsReceipts.id, id))
    .limit(1);
  if (!head) return null;
  const lines = await tx
    .select({
      itemId: goodsReceiptLines.itemId,
      quantity: goodsReceiptLines.quantity,
      unitPrice: purchaseOrderLines.unitPrice,
      gstRate: purchaseOrderLines.gstRate,
    })
    .from(goodsReceiptLines)
    .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.id, goodsReceiptLines.orderLineId))
    .where(eq(goodsReceiptLines.receiptId, id))
    .orderBy(asc(goodsReceiptLines.id));
  return { ...head, lines };
}

// ------------------------------------------------------------------ payments

const paymentCreator = alias(users, 'payment_creator');
const paymentVoider = alias(users, 'payment_voider');

export type PaymentRow = {
  id: string;
  number: string;
  kind: InvoiceKind;
  amount: string;
  method: string;
  paidOn: string;
  reference: string | null;
  createdAt: Date;
  createdByName: string;
  voidedAt: Date | null;
  voidedByName: string | null;
  voidReason: string | null;
  journalEntryId: string;
  invoice: { id: string; number: string };
  partyName: string;
};

const paymentBase = (tx: TenantTx) =>
  tx
    .select({
      id: payments.id,
      number: payments.number,
      kind: payments.kind,
      amount: payments.amount,
      method: payments.method,
      paidOn: payments.paidOn,
      reference: payments.reference,
      createdAt: payments.createdAt,
      createdByName: paymentCreator.fullName,
      voidedAt: payments.voidedAt,
      voidedByName: paymentVoider.fullName,
      voidReason: payments.voidReason,
      journalEntryId: payments.journalEntryId,
      invoiceId: invoices.id,
      invoiceNumber: invoices.number,
      customerName: customers.name,
      supplierName: suppliers.name,
    })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .innerJoin(paymentCreator, eq(paymentCreator.id, payments.createdBy))
    .leftJoin(paymentVoider, eq(paymentVoider.id, payments.voidedBy))
    .leftJoin(customers, eq(customers.id, invoices.customerId))
    .leftJoin(suppliers, eq(suppliers.id, invoices.supplierId));

type PaymentJoined = Awaited<ReturnType<typeof paymentBase>>[number];

const shapePayment = (r: PaymentJoined): PaymentRow => ({
  id: r.id,
  number: r.number,
  kind: r.kind,
  amount: r.amount,
  method: r.method,
  paidOn: r.paidOn,
  reference: r.reference,
  createdAt: r.createdAt,
  createdByName: r.createdByName,
  voidedAt: r.voidedAt,
  voidedByName: r.voidedByName,
  voidReason: r.voidReason,
  journalEntryId: r.journalEntryId,
  invoice: { id: r.invoiceId, number: r.invoiceNumber },
  partyName: (r.kind === 'sales' ? r.customerName : r.supplierName) ?? '',
});

export async function listPayments(
  tx: TenantTx,
  filter: {
    scope: Scope;
    userId: string;
    kind?: InvoiceKind;
    invoiceId?: string;
    limit: number;
    offset: number;
  },
) {
  const where = and(
    invoiceScope(filter.scope, filter.userId),
    filter.kind ? eq(payments.kind, filter.kind) : undefined,
    filter.invoiceId ? eq(payments.invoiceId, filter.invoiceId) : undefined,
  );
  const rows = await paymentBase(tx)
    .where(where)
    .orderBy(desc(payments.createdAt), desc(payments.id))
    .limit(filter.limit)
    .offset(filter.offset);
  const [count] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(payments)
    .innerJoin(invoices, eq(invoices.id, payments.invoiceId))
    .where(where);
  return { items: rows.map(shapePayment), total: count!.n };
}

export async function findPayment(tx: TenantTx, id: string): Promise<PaymentRow | null> {
  const [row] = await paymentBase(tx).where(eq(payments.id, id)).limit(1);
  return row ? shapePayment(row) : null;
}

export async function lockPayment(tx: TenantTx, id: string) {
  const [row] = await tx
    .select({
      id: payments.id,
      invoiceId: payments.invoiceId,
      amount: payments.amount,
      kind: payments.kind,
      method: payments.method,
      number: payments.number,
      journalEntryId: payments.journalEntryId,
      voidedAt: payments.voidedAt,
    })
    .from(payments)
    .where(eq(payments.id, id))
    .for('update')
    .limit(1);
  return row ?? null;
}

export async function insertPayment(
  tx: TenantTx,
  values: {
    tenantId: string;
    number: string;
    kind: InvoiceKind;
    invoiceId: string;
    amount: string;
    method: string;
    paidOn: string;
    reference: string | null;
    journalEntryId: string;
    createdBy: string;
  },
): Promise<string> {
  const [row] = await tx.insert(payments).values(values).returning({ id: payments.id });
  return row!.id;
}

export async function markPaymentVoided(
  tx: TenantTx,
  id: string,
  values: { voidedBy: string; voidReason: string },
): Promise<void> {
  await tx
    .update(payments)
    .set({ ...values, voidedAt: sql`now()` })
    .where(eq(payments.id, id));
}

export async function paymentsFor(tx: TenantTx, invoiceId: string): Promise<PaymentRow[]> {
  const rows = await paymentBase(tx)
    .where(eq(payments.invoiceId, invoiceId))
    .orderBy(desc(payments.createdAt), desc(payments.id));
  return rows.map(shapePayment);
}
