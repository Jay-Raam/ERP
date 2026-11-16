import {
  ACCOUNT_TYPES,
  DEBIT_NORMAL,
  accountLedgerInputSchema,
  ageingInputSchema,
  cancelInvoiceInputSchema,
  createAccountInputSchema,
  createInvoiceInputSchema,
  createJournalEntryInputSchema,
  hasPermission,
  lineAmounts,
  listInvoicesInputSchema,
  listJournalInputSchema,
  listPaymentsInputSchema,
  orderAmounts,
  parsePaise,
  paiseToString,
  postInvoiceInputSchema,
  recordPaymentInputSchema,
  reverseJournalInputSchema,
  trialBalanceInputSchema,
  updateAccountInputSchema,
  updateInvoiceInputSchema,
  voidPaymentInputSchema,
  type AccountType,
  type InvoiceKind,
  type Viewer,
} from '@erp/shared';
import { requirePermission } from '../../core/auth/guard';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../core/errors';
import { parseId } from '../../core/errors/parse-id';
import type { Logger } from '../../core/logger';
import { enforceLimit, type Limits, type RateLimiter } from '../../core/rate-limit';
import type { Database, TenantTx } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import { withTenant } from '../../db/tenant';
import { localDate } from '../hr/attendance.logic';
import { organisationZone } from '../hr/attendance.repository';
import { assertBranchInScope, inScope, scopeOf } from '../hr/scope';
import * as storeRepo from '../store/store.repository';
import * as repo from './accounts.repository';
import { ensureAccountDefaults, type SystemCode } from './defaults.repository';
import * as ledger from './ledger';
import { systemAccountIds } from './ledger';

const STALE = 'Someone else changed this record. Reload it and try again.';

export interface AccountsDeps {
  db: Database;
  logger: Logger;
  limiter: RateLimiter;
  limits: Limits;
  now?: () => Date;
}

const ZERO = 0n;

export function createAccountsService({
  db,
  logger,
  limiter,
  limits,
  now = () => new Date(),
}: AccountsDeps) {
  const run = <T>(viewer: Viewer, fn: (tx: TenantTx, tenantId: string) => Promise<T>) =>
    withTenant(db, viewer.organisation.id, (tx) => fn(tx, viewer.organisation.id));

  const audit = (viewer: Viewer, action: string, target: Record<string, unknown>) =>
    logger.info(
      { audit: true, actor: viewer.user.id, tenantId: viewer.organisation.id, action, ...target },
      'accounts action',
    );

  const limitWrites = (viewer: Viewer) =>
    enforceLimit(
      limiter,
      `acct:user:${viewer.user.id}`,
      limits.accountsWritesPerUser,
      'You are posting too quickly.',
    );

  const today = async (tx: TenantTx) => localDate(now(), await organisationZone(tx));

  /** An invoice outside the viewer's scope looks exactly like a missing one. */
  const invoiceVisible = (viewer: Viewer, inv: { branchId: string; createdBy: string }) =>
    inScope(viewer, { branchId: inv.branchId, userId: inv.createdBy });

  const entryVisible = (viewer: Viewer, e: { branchId: string | null; createdBy: string }) => {
    switch (viewer.role.dataScope) {
      case 'organisation':
        return true;
      case 'branch':
        return e.branchId !== null && viewer.branches.some((b) => b.id === e.branchId);
      case 'own':
        return e.createdBy === viewer.user.id;
    }
  };

  const systemIds = (tx: TenantTx, tenantId: string) => systemAccountIds(tx, tenantId);

  const postEntry = (
    tx: TenantTx,
    viewer: Viewer,
    tenantId: string,
    e: Parameters<typeof ledger.postEntry>[3],
    ids: Map<string, string>,
  ) => ledger.postEntry(tx, viewer.user.id, tenantId, e, ids);

  const reverse = (
    tx: TenantTx,
    viewer: Viewer,
    tenantId: string,
    original: { id: string; branchId: string | null; number: string },
    memo: string,
    entryDate: string,
  ) => ledger.reverseEntry(tx, viewer.user.id, tenantId, original, memo, entryDate);

  async function invoiceDetail(viewer: Viewer, tx: TenantTx, id: string) {
    const invoice = await repo.findInvoice(tx, id);
    if (
      !invoice ||
      !invoiceVisible(viewer, { branchId: invoice.branch.id, createdBy: invoice.createdBy })
    ) {
      throw new NotFoundError('Invoice not found');
    }
    const canSeePayments = hasPermission(viewer.permissions, 'accounts.payment.view');
    return {
      ...invoice,
      lines: await repo.listInvoiceLines(tx, id),
      payments: canSeePayments ? await repo.paymentsFor(tx, id) : [],
    };
  }

  async function lockVisible(tx: TenantTx, viewer: Viewer, id: string) {
    const inv = await repo.lockInvoice(tx, id);
    if (!inv || !invoiceVisible(viewer, inv)) throw new NotFoundError('Invoice not found');
    return inv;
  }

  const normal = (type: AccountType) => DEBIT_NORMAL.includes(type);
  const signed = (type: AccountType, debitMinusCredit: string) => {
    const v = parsePaise(debitMinusCredit);
    return paiseToString(normal(type) ? v : -v);
  };

  return {
    // ---------------------------------------------------------------- accounts

    async listAccounts(viewer: Viewer) {
      requirePermission(viewer, 'accounts.account.view');
      return run(viewer, async (tx, tenantId) => {
        await ensureAccountDefaults(tx, tenantId);
        return repo.listAccounts(tx);
      });
    },

    async createAccount(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'accounts.account.manage');
      await limitWrites(viewer);
      const input = createAccountInputSchema.parse(raw);
      try {
        const id = await run(viewer, async (tx, tenantId) => {
          await ensureAccountDefaults(tx, tenantId);
          return repo.insertAccount(tx, { ...input, tenantId });
        });
        audit(viewer, 'account.create', { accountId: id });
        return (await run(viewer, (tx) => repo.findAccount(tx, id)))!;
      } catch (error) {
        if (isUniqueViolation(error)) {
          const message = 'An account with this code already exists';
          throw new ConflictError(message, { fieldErrors: { code: [message] } });
        }
        throw error;
      }
    },

    async updateAccount(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'accounts.account.manage');
      await limitWrites(viewer);
      const id = parseId(rawId);
      const { version, ...values } = updateAccountInputSchema.parse(raw);
      await run(viewer, async (tx) => {
        const account = await repo.findAccount(tx, id);
        if (!account) throw new NotFoundError('Account not found');
        if (account.isSystem && values.status === 'inactive') {
          throw new BusinessRuleError('A system account is used by automatic postings');
        }
        if (!(await repo.updateAccount(tx, id, version, values))) throw new ConflictError(STALE);
      });
      audit(viewer, 'account.update', { accountId: id });
      return (await run(viewer, (tx) => repo.findAccount(tx, id)))!;
    },

    // ----------------------------------------------------------------- journal

    async listJournal(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'accounts.journal.view');
      const input = listJournalInputSchema.parse(raw ?? {});
      return run(viewer, (tx) =>
        repo.listEntries(tx, { ...input, scope: scopeOf(viewer), userId: viewer.user.id }),
      );
    },

    async getJournalEntry(viewer: Viewer, rawId: unknown) {
      requirePermission(viewer, 'accounts.journal.view');
      const id = parseId(rawId);
      return run(viewer, async (tx) => {
        const owner = await repo.entryOwnership(tx, id);
        if (!owner || !entryVisible(viewer, owner)) throw new NotFoundError('Entry not found');
        return { ...(await repo.findEntry(tx, id))!, lines: await repo.entryLines(tx, id) };
      });
    },

    async createJournalEntry(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'accounts.journal.create');
      const input = createJournalEntryInputSchema.parse(raw);
      if (input.branchId) assertBranchInScope(viewer, input.branchId);
      else if (viewer.role.dataScope !== 'organisation') {
        throw new ValidationError({ branchId: ['Choose a branch for this entry'] });
      }
      await limitWrites(viewer);
      const id = await run(viewer, async (tx, tenantId) => {
        const date = await today(tx);
        if (input.entryDate > date) {
          throw new ValidationError({ entryDate: ['The entry date cannot be in the future'] });
        }
        const ids = await systemIds(tx, tenantId);
        const chart = new Map((await repo.listAccounts(tx)).map((a) => [a.id, a]));
        input.lines.forEach((l, index) => {
          const account = chart.get(l.accountId);
          if (!account) {
            throw new ValidationError({ [`lines.${index}.accountId`]: ['Choose an account'] });
          }
          if (account.status !== 'active') {
            throw new ValidationError({
              [`lines.${index}.accountId`]: ['This account is inactive'],
            });
          }
        });
        if (input.branchId) {
          const branch = await storeRepo.findBranch(tx, input.branchId);
          if (!branch) throw new ValidationError({ branchId: ['Choose a branch'] });
        }
        return postEntry(
          tx,
          viewer,
          tenantId,
          {
            entryDate: input.entryDate,
            memo: input.memo,
            sourceType: 'manual',
            sourceId: null,
            branchId: input.branchId,
            lines: input.lines.map((l) => ({
              account: { id: l.accountId },
              debit: parsePaise(l.debit),
              credit: parsePaise(l.credit),
            })),
          },
          ids,
        );
      });
      audit(viewer, 'journal.create', { entryId: id });
      return run(viewer, async (tx) => ({
        ...(await repo.findEntry(tx, id))!,
        lines: await repo.entryLines(tx, id),
      }));
    },

    async reverseJournalEntry(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'accounts.journal.create');
      const id = parseId(rawId);
      const { reason } = reverseJournalInputSchema.parse(raw);
      await limitWrites(viewer);
      const reversalId = await run(viewer, async (tx, tenantId) => {
        const owner = await repo.entryOwnership(tx, id);
        if (!owner || !entryVisible(viewer, owner)) throw new NotFoundError('Entry not found');
        if (owner.sourceType !== 'manual') {
          throw new BusinessRuleError(
            'Only a manual entry can be reversed here. Cancel the invoice or void the payment instead.',
          );
        }
        return reverse(
          tx,
          viewer,
          tenantId,
          { id, branchId: owner.branchId, number: owner.number },
          `Reversal of ${owner.number}: ${reason}`,
          await today(tx),
        );
      });
      audit(viewer, 'journal.reverse', { entryId: id, reversalId });
      return run(viewer, async (tx) => ({
        ...(await repo.findEntry(tx, reversalId))!,
        lines: await repo.entryLines(tx, reversalId),
      }));
    },

    // ----------------------------------------------------------------- reports

    async trialBalance(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'accounts.report.view');
      const input = trialBalanceInputSchema.parse(raw ?? {});
      return run(viewer, async (tx, tenantId) => {
        await ensureAccountDefaults(tx, tenantId);
        const asOf = input.asOf ?? (await today(tx));
        const rows = await repo.trialBalance(tx, scopeOf(viewer), viewer.user.id, asOf);
        let debit = ZERO;
        let credit = ZERO;
        // A trial balance lists each account's net position: one figure, on its debit or credit side.
        const shaped = rows.map((r) => {
          const d = parsePaise(r.debit);
          const c = parsePaise(r.credit);
          const net = d - c;
          const netDebit = net > ZERO ? net : ZERO;
          const netCredit = net < ZERO ? -net : ZERO;
          debit += netDebit;
          credit += netCredit;
          const balance = normal(r.type) ? net : -net;
          return {
            ...r,
            debit: paiseToString(netDebit),
            credit: paiseToString(netCredit),
            balance: paiseToString(balance),
          };
        });
        return {
          asOf,
          rows: shaped,
          totalDebit: paiseToString(debit),
          totalCredit: paiseToString(credit),
          balanced: debit === credit,
        };
      });
    },

    async accountLedger(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'accounts.journal.view');
      const input = accountLedgerInputSchema.parse(raw);
      return run(viewer, async (tx) => {
        const account = await repo.findAccount(tx, input.accountId);
        if (!account) throw new NotFoundError('Account not found');
        const page = await repo.accountLedger(tx, {
          ...input,
          scope: scopeOf(viewer),
          userId: viewer.user.id,
        });
        return {
          account,
          opening: signed(account.type, page.opening),
          total: page.total,
          items: page.items.map((r) => ({
            ...r,
            balance: signed(account.type, r.running),
          })),
        };
      });
    },

    async ageing(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'accounts.report.view');
      const { kind } = ageingInputSchema.parse(raw);
      return run(viewer, async (tx) => {
        const date = await today(tx);
        const rows = await repo.ageing(tx, { kind, scope: scopeOf(viewer), today: date });
        const sum = (pick: (r: (typeof rows)[number]) => string) =>
          paiseToString(rows.reduce((a, r) => a + parsePaise(pick(r)), ZERO));
        return {
          asOf: date,
          rows,
          totals: {
            current: sum((r) => r.current),
            days30: sum((r) => r.days30),
            days60: sum((r) => r.days60),
            days90: sum((r) => r.days90),
            over90: sum((r) => r.over90),
            total: sum((r) => r.total),
          },
        };
      });
    },

    // ---------------------------------------------------------------- invoices

    async listInvoices(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'accounts.invoice.view');
      const input = listInvoicesInputSchema.parse(raw ?? {});
      return run(viewer, (tx) =>
        repo.listInvoices(tx, { ...input, scope: scopeOf(viewer), userId: viewer.user.id }),
      );
    },

    async getInvoice(viewer: Viewer, rawId: unknown) {
      requirePermission(viewer, 'accounts.invoice.view');
      const id = parseId(rawId);
      return run(viewer, (tx) => invoiceDetail(viewer, tx, id));
    },

    async createInvoice(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'accounts.invoice.create');
      const input = createInvoiceInputSchema.parse(raw);
      await limitWrites(viewer);
      try {
        const id = await run(viewer, async (tx, tenantId) => {
          const source =
            input.kind === 'sales'
              ? await repo.findDeliverySource(tx, input.sourceId)
              : await repo.findReceiptSource(tx, input.sourceId);
          if (
            !source ||
            !inScope(viewer, { branchId: source.branchId, userId: source.orderCreatedBy })
          ) {
            throw new NotFoundError(
              input.kind === 'sales' ? 'Delivery not found' : 'Goods receipt not found',
            );
          }
          if (source.partyStatus !== 'active') {
            throw new BusinessRuleError(
              input.kind === 'sales' ? 'This customer is inactive' : 'This supplier is inactive',
            );
          }
          // Amounts come from the order's prices and the delivered quantities, never the client.
          const priced = source.lines.map((l) => ({
            line: l,
            ...lineAmounts(l.quantity, l.unitPrice, l.gstRate),
          }));
          const totals = orderAmounts(priced);
          if (parsePaise(totals.total) === ZERO) {
            throw new BusinessRuleError('The invoice amount works out to zero');
          }
          const invoiceId = await repo.insertInvoice(tx, {
            tenantId,
            number: await repo.nextNumber(tx, tenantId, input.kind === 'sales' ? 'INV' : 'BILL'),
            kind: input.kind,
            branchId: source.branchId,
            customerId: input.kind === 'sales' ? source.partyId : null,
            supplierId: input.kind === 'purchase' ? source.partyId : null,
            deliveryId: input.kind === 'sales' ? source.id : null,
            receiptId: input.kind === 'purchase' ? source.id : null,
            reference: input.reference ?? source.reference,
            invoiceDate: input.invoiceDate,
            dueDate: input.dueDate ?? input.invoiceDate,
            notes: input.notes,
            subtotal: totals.subtotal,
            taxTotal: totals.tax,
            grandTotal: totals.total,
            createdBy: viewer.user.id,
          });
          await repo.insertInvoiceLines(
            tx,
            tenantId,
            invoiceId,
            priced.map((p) => ({
              itemId: p.line.itemId,
              quantity: p.line.quantity,
              unitPrice: p.line.unitPrice,
              gstRate: p.line.gstRate,
              subtotal: paiseToString(p.subtotal),
              taxAmount: paiseToString(p.tax),
              total: paiseToString(p.total),
            })),
          );
          return invoiceId;
        });
        audit(viewer, 'invoice.create', { invoiceId: id, kind: input.kind });
        return run(viewer, (tx) => invoiceDetail(viewer, tx, id));
      } catch (error) {
        if (isUniqueViolation(error, 'invoices_delivery_once')) {
          throw new BusinessRuleError('This delivery already has an invoice');
        }
        if (isUniqueViolation(error, 'invoices_receipt_once')) {
          throw new BusinessRuleError('This goods receipt already has a bill');
        }
        throw error;
      }
    },

    async updateInvoice(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'accounts.invoice.create');
      const id = parseId(rawId);
      const { version, ...values } = updateInvoiceInputSchema.parse(raw);
      await run(viewer, async (tx) => {
        const inv = await lockVisible(tx, viewer, id);
        if (inv.status !== 'draft') {
          throw new BusinessRuleError('Only a draft can be edited');
        }
        const ok = await repo.updateDraftInvoice(tx, id, version, {
          ...values,
          dueDate: values.dueDate ?? values.invoiceDate,
        });
        if (!ok) throw new ConflictError(STALE);
      });
      audit(viewer, 'invoice.update', { invoiceId: id });
      return run(viewer, (tx) => invoiceDetail(viewer, tx, id));
    },

    async postInvoice(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'accounts.invoice.post');
      const id = parseId(rawId);
      const { version } = postInvoiceInputSchema.parse(raw);
      await limitWrites(viewer);
      await run(viewer, async (tx, tenantId) => {
        const inv = await lockVisible(tx, viewer, id);
        if (inv.version !== version) throw new ConflictError(STALE);
        if (inv.status !== 'draft') {
          throw new BusinessRuleError('Only a draft can be posted');
        }
        const ids = await systemIds(tx, tenantId);
        const subtotal = parsePaise(inv.subtotal);
        const tax = parsePaise(inv.taxTotal);
        const total = parsePaise(inv.grandTotal);
        const sales = inv.kind === 'sales';
        const entryId = await postEntry(
          tx,
          viewer,
          tenantId,
          {
            entryDate: inv.invoiceDate,
            memo: `${sales ? 'Sales invoice' : 'Supplier bill'} ${inv.number}`,
            sourceType: 'invoice',
            sourceId: inv.id,
            branchId: inv.branchId,
            lines: sales
              ? [
                  { account: '1100', debit: total, credit: ZERO },
                  { account: '4000', debit: ZERO, credit: subtotal },
                  { account: '2100', debit: ZERO, credit: tax },
                ]
              : [
                  { account: '5000', debit: subtotal, credit: ZERO },
                  { account: '1300', debit: tax, credit: ZERO },
                  { account: '2000', debit: ZERO, credit: total },
                ],
          },
          ids,
        );
        await repo.setInvoiceState(tx, id, {
          status: 'posted',
          journalEntryId: entryId,
          postedBy: viewer.user.id,
          postedAt: new Date(),
        });
      });
      audit(viewer, 'invoice.post', { invoiceId: id });
      return run(viewer, (tx) => invoiceDetail(viewer, tx, id));
    },

    async cancelInvoice(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'accounts.invoice.cancel');
      const id = parseId(rawId);
      const { version, reason } = cancelInvoiceInputSchema.parse(raw);
      await limitWrites(viewer);
      await run(viewer, async (tx, tenantId) => {
        const inv = await lockVisible(tx, viewer, id);
        if (inv.version !== version) throw new ConflictError(STALE);
        if (inv.status === 'cancelled') throw new BusinessRuleError('Already cancelled');
        if (inv.status === 'posted') {
          if (parsePaise(inv.paidAmount) > ZERO) {
            throw new BusinessRuleError('Void the payments on this invoice first');
          }
          await reverse(
            tx,
            viewer,
            tenantId,
            { id: inv.journalEntryId!, branchId: inv.branchId, number: inv.number },
            `Cancelled ${inv.number}: ${reason}`,
            await today(tx),
          );
        }
        await repo.setInvoiceState(tx, id, {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelReason: reason,
        });
      });
      audit(viewer, 'invoice.cancel', { invoiceId: id });
      return run(viewer, (tx) => invoiceDetail(viewer, tx, id));
    },

    // ---------------------------------------------------------------- payments

    async listPayments(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'accounts.payment.view');
      const input = listPaymentsInputSchema.parse(raw ?? {});
      return run(viewer, (tx) =>
        repo.listPayments(tx, { ...input, scope: scopeOf(viewer), userId: viewer.user.id }),
      );
    },

    async recordPayment(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'accounts.payment.create');
      const input = recordPaymentInputSchema.parse(raw);
      await limitWrites(viewer);
      const paymentId = await run(viewer, async (tx, tenantId) => {
        const inv = await lockVisible(tx, viewer, input.invoiceId);
        if (inv.status !== 'posted') {
          throw new BusinessRuleError(
            inv.status === 'draft'
              ? 'Post the invoice before recording a payment'
              : 'This invoice is cancelled',
          );
        }
        const date = await today(tx);
        if (input.paidOn > date) {
          throw new ValidationError({ paidOn: ['The payment date cannot be in the future'] });
        }
        if (input.paidOn < inv.invoiceDate) {
          throw new ValidationError({ paidOn: ['The payment date cannot be before the invoice'] });
        }
        const amount = parsePaise(input.amount);
        const outstanding = parsePaise(inv.grandTotal) - parsePaise(inv.paidAmount);
        if (amount > outstanding) {
          const message = `Only ${paiseToString(outstanding)} is outstanding on this invoice`;
          throw new BusinessRuleError(message, { fieldErrors: { amount: [message] } });
        }
        const ids = await systemIds(tx, tenantId);
        const sales = inv.kind === 'sales';
        const till: SystemCode = input.method === 'cash' ? '1000' : '1010';
        const number = await repo.nextNumber(tx, tenantId, sales ? 'RCT' : 'PAY');
        const entryId = await postEntry(
          tx,
          viewer,
          tenantId,
          {
            entryDate: input.paidOn,
            memo: `${sales ? 'Receipt' : 'Payment'} ${number} for ${inv.number}`,
            sourceType: 'payment',
            sourceId: inv.id,
            branchId: inv.branchId,
            lines: sales
              ? [
                  { account: till, debit: amount, credit: ZERO },
                  { account: '1100', debit: ZERO, credit: amount },
                ]
              : [
                  { account: '2000', debit: amount, credit: ZERO },
                  { account: till, debit: ZERO, credit: amount },
                ],
          },
          ids,
        );
        const created = await repo.insertPayment(tx, {
          tenantId,
          number,
          kind: inv.kind,
          invoiceId: inv.id,
          amount: input.amount,
          method: input.method,
          paidOn: input.paidOn,
          reference: input.reference,
          journalEntryId: entryId,
          createdBy: viewer.user.id,
        });
        // The WHERE clause is the final guard against overpaying under parallel requests.
        if (!(await repo.addPaid(tx, inv.id, paiseToString(amount)))) {
          throw new BusinessRuleError('This payment is more than the amount outstanding');
        }
        return created;
      });
      audit(viewer, 'payment.create', { paymentId });
      return run(viewer, async (tx) => (await repo.findPayment(tx, paymentId))!);
    },

    async voidPayment(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'accounts.payment.void');
      const id = parseId(rawId);
      const { reason } = voidPaymentInputSchema.parse(raw);
      await limitWrites(viewer);
      await run(viewer, async (tx, tenantId) => {
        const found = await repo.findPayment(tx, id);
        if (!found) throw new NotFoundError('Payment not found');
        // Always lock the invoice before the payment, so two voids and a new payment cannot deadlock.
        const inv = await lockVisible(tx, viewer, found.invoice.id);
        const payment = await repo.lockPayment(tx, id);
        if (!payment) throw new NotFoundError('Payment not found');
        if (payment.voidedAt) throw new BusinessRuleError('This payment is already voided');
        await reverse(
          tx,
          viewer,
          tenantId,
          { id: payment.journalEntryId, branchId: inv.branchId, number: payment.number },
          `Voided ${payment.number}: ${reason}`,
          await today(tx),
        );
        if (!(await repo.subtractPaid(tx, inv.id, payment.amount))) {
          throw new BusinessRuleError('The invoice balance does not allow this void');
        }
        await repo.markPaymentVoided(tx, id, { voidedBy: viewer.user.id, voidReason: reason });
      });
      audit(viewer, 'payment.void', { paymentId: id });
      return run(viewer, async (tx) => (await repo.findPayment(tx, id))!);
    },

    // Types used by the GraphQL layer.
    accountTypes: ACCOUNT_TYPES,
  };
}

export type AccountsService = ReturnType<typeof createAccountsService>;
export type { InvoiceKind };
