import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps, version } from './columns';
import { customers, deliveries } from './sales';
import { goodsReceipts, suppliers } from './purchase';
import { items } from './store';
import { branches, organisations, recordStatus, users } from './tenancy';

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'restrict' });

const quantity = (name: string) => numeric(name, { precision: 14, scale: 3 });
const money = (name: string, precision = 18) => numeric(name, { precision, scale: 2 });

export const accountType = pgEnum('account_type', [
  'asset',
  'liability',
  'equity',
  'income',
  'expense',
]);
export const invoiceKind = pgEnum('invoice_kind', ['sales', 'purchase']);
export const invoiceStatus = pgEnum('invoice_status', ['draft', 'posted', 'cancelled']);

/** The chart of accounts. Codes and types never change once created. */
export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: accountType('type').notNull(),
    /** System accounts are used by automatic postings and cannot be deactivated. */
    isSystem: boolean('is_system').notNull().default(false),
    status: recordStatus('status').notNull().default('active'),
    ...timestamps,
    version: version(),
  },
  (t) => [
    unique('accounts_tenant_code_unique').on(t.tenantId, t.code),
    unique('accounts_tenant_id_unique').on(t.tenantId, t.id),
  ],
);

/** A balanced set of journal lines. Append-only: a mistake is fixed with a reversing entry. */
export const journalEntries = pgTable(
  'journal_entries',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    entryDate: date('entry_date', { mode: 'string' }).notNull(),
    memo: text('memo').notNull(),
    /** invoice | payment | manual | reversal */
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id'),
    branchId: uuid('branch_id'),
    reversalOf: uuid('reversal_of'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('journal_entries_tenant_number_unique').on(t.tenantId, t.number),
    unique('journal_entries_tenant_id_unique').on(t.tenantId, t.id),
    // An entry can be reversed only once.
    uniqueIndex('journal_entries_reversal_once').on(t.tenantId, t.reversalOf),
    foreignKey({
      name: 'journal_entries_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'journal_entries_created_by_fk',
      columns: [t.tenantId, t.createdBy],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'journal_entries_reversal_fk',
      columns: [t.tenantId, t.reversalOf],
      foreignColumns: [t.tenantId, t.id],
    }).onDelete('restrict'),
    check(
      'journal_entries_source_type',
      sql`${t.sourceType} in ('invoice','payment','manual','reversal','payroll')`,
    ),
    index('journal_entries_date_idx').on(t.tenantId, t.entryDate, t.createdAt),
  ],
);

export const journalLines = pgTable(
  'journal_lines',
  {
    id: id(),
    tenantId: tenantId(),
    entryId: uuid('entry_id').notNull(),
    accountId: uuid('account_id').notNull(),
    debit: money('debit').notNull().default('0'),
    credit: money('credit').notNull().default('0'),
  },
  (t) => [
    foreignKey({
      name: 'journal_lines_entry_fk',
      columns: [t.tenantId, t.entryId],
      foreignColumns: [journalEntries.tenantId, journalEntries.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'journal_lines_account_fk',
      columns: [t.tenantId, t.accountId],
      foreignColumns: [accounts.tenantId, accounts.id],
    }).onDelete('restrict'),
    // Exactly one side carries an amount.
    check(
      'journal_lines_one_side',
      sql`(${t.debit} > 0 and ${t.credit} = 0) or (${t.credit} > 0 and ${t.debit} = 0)`,
    ),
    index('journal_lines_entry_idx').on(t.tenantId, t.entryId),
    index('journal_lines_account_idx').on(t.tenantId, t.accountId),
  ],
);

/** A sales invoice (made from a delivery) or a supplier bill (made from a goods receipt). */
export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    kind: invoiceKind('kind').notNull(),
    status: invoiceStatus('status').notNull().default('draft'),
    branchId: uuid('branch_id').notNull(),
    customerId: uuid('customer_id'),
    supplierId: uuid('supplier_id'),
    deliveryId: uuid('delivery_id'),
    receiptId: uuid('receipt_id'),
    /** The supplier's own bill number, or a customer reference. */
    reference: text('reference'),
    invoiceDate: date('invoice_date', { mode: 'string' }).notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    notes: text('notes'),
    subtotal: money('subtotal').notNull(),
    taxTotal: money('tax_total').notNull(),
    grandTotal: money('grand_total').notNull(),
    /** Total of payments that are not voided; never above the grand total. */
    paidAmount: money('paid_amount').notNull().default('0'),
    journalEntryId: uuid('journal_entry_id'),
    createdBy: uuid('created_by').notNull(),
    postedBy: uuid('posted_by'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    ...timestamps,
    version: version(),
  },
  (t) => [
    unique('invoices_tenant_number_unique').on(t.tenantId, t.number),
    unique('invoices_tenant_id_unique').on(t.tenantId, t.id),
    // One live invoice per delivery or receipt.
    uniqueIndex('invoices_delivery_once')
      .on(t.tenantId, t.deliveryId)
      .where(sql`${t.status} <> 'cancelled'`),
    uniqueIndex('invoices_receipt_once')
      .on(t.tenantId, t.receiptId)
      .where(sql`${t.status} <> 'cancelled'`),
    foreignKey({
      name: 'invoices_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'invoices_customer_fk',
      columns: [t.tenantId, t.customerId],
      foreignColumns: [customers.tenantId, customers.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'invoices_supplier_fk',
      columns: [t.tenantId, t.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'invoices_delivery_fk',
      columns: [t.tenantId, t.deliveryId],
      foreignColumns: [deliveries.tenantId, deliveries.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'invoices_receipt_fk',
      columns: [t.tenantId, t.receiptId],
      foreignColumns: [goodsReceipts.tenantId, goodsReceipts.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'invoices_journal_fk',
      columns: [t.tenantId, t.journalEntryId],
      foreignColumns: [journalEntries.tenantId, journalEntries.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'invoices_created_by_fk',
      columns: [t.tenantId, t.createdBy],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'invoices_posted_by_fk',
      columns: [t.tenantId, t.postedBy],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('restrict'),
    // A sales invoice has a customer and a delivery; a bill has a supplier and a receipt.
    check(
      'invoices_party_matches_kind',
      sql`(${t.kind} = 'sales' and ${t.customerId} is not null and ${t.supplierId} is null and ${t.deliveryId} is not null and ${t.receiptId} is null)
        or (${t.kind} = 'purchase' and ${t.supplierId} is not null and ${t.customerId} is null and ${t.receiptId} is not null and ${t.deliveryId} is null)`,
    ),
    check('invoices_paid_range', sql`${t.paidAmount} >= 0 and ${t.paidAmount} <= ${t.grandTotal}`),
    check('invoices_total_positive', sql`${t.grandTotal} > 0`),
    check('invoices_due_after_date', sql`${t.dueDate} >= ${t.invoiceDate}`),
    index('invoices_list_idx').on(t.tenantId, t.kind, t.createdAt),
  ],
);

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: id(),
    tenantId: tenantId(),
    invoiceId: uuid('invoice_id').notNull(),
    itemId: uuid('item_id').notNull(),
    quantity: quantity('quantity').notNull(),
    unitPrice: money('unit_price', 14).notNull(),
    gstRate: smallint('gst_rate').notNull(),
    subtotal: money('subtotal').notNull(),
    taxAmount: money('tax_amount').notNull(),
    total: money('total').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'invoice_lines_invoice_fk',
      columns: [t.tenantId, t.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'invoice_lines_item_fk',
      columns: [t.tenantId, t.itemId],
      foreignColumns: [items.tenantId, items.id],
    }).onDelete('restrict'),
    check('invoice_lines_qty_positive', sql`${t.quantity} > 0`),
    index('invoice_lines_invoice_idx').on(t.tenantId, t.invoiceId),
  ],
);

/** Money in (sales invoice) or out (supplier bill). A mistake is voided, never edited or deleted. */
export const payments = pgTable(
  'payments',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    kind: invoiceKind('kind').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    amount: money('amount').notNull(),
    method: text('method').notNull(),
    paidOn: date('paid_on', { mode: 'string' }).notNull(),
    reference: text('reference'),
    journalEntryId: uuid('journal_entry_id').notNull(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by'),
    voidReason: text('void_reason'),
  },
  (t) => [
    unique('payments_tenant_number_unique').on(t.tenantId, t.number),
    unique('payments_tenant_id_unique').on(t.tenantId, t.id),
    foreignKey({
      name: 'payments_invoice_fk',
      columns: [t.tenantId, t.invoiceId],
      foreignColumns: [invoices.tenantId, invoices.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'payments_journal_fk',
      columns: [t.tenantId, t.journalEntryId],
      foreignColumns: [journalEntries.tenantId, journalEntries.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'payments_created_by_fk',
      columns: [t.tenantId, t.createdBy],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('restrict'),
    foreignKey({
      name: 'payments_voided_by_fk',
      columns: [t.tenantId, t.voidedBy],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('restrict'),
    check('payments_amount_positive', sql`${t.amount} > 0`),
    check('payments_method', sql`${t.method} in ('cash','bank','upi','cheque','card')`),
    check(
      'payments_void_complete',
      sql`(${t.voidedAt} is null and ${t.voidedBy} is null and ${t.voidReason} is null)
        or (${t.voidedAt} is not null and ${t.voidedBy} is not null and ${t.voidReason} is not null)`,
    ),
    index('payments_invoice_idx').on(t.tenantId, t.invoiceId),
    index('payments_list_idx').on(t.tenantId, t.kind, t.createdAt),
  ],
);
