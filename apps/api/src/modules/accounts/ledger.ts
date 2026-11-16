import { paiseToString, parsePaise } from '@erp/shared';
import { BusinessRuleError } from '../../core/errors';
import type { TenantTx } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import * as repo from './accounts.repository';
import { ensureAccountDefaults, type SystemCode } from './defaults.repository';

/**
 * Posting to the ledger, shared by every module that books money (invoices, payments,
 * payroll). Always runs inside the caller's transaction, so a document and its entry
 * commit together or not at all.
 */

export type PostLine = { account: SystemCode | { id: string }; debit: bigint; credit: bigint };

export interface EntryInput {
  entryDate: string;
  memo: string;
  sourceType: 'invoice' | 'payment' | 'manual' | 'reversal' | 'payroll';
  sourceId: string | null;
  branchId: string | null;
  reversalOf?: string | null;
  lines: PostLine[];
}

/** System account ids by code. Only accounts flagged as system count: a custom account never receives automatic postings. */
export async function systemAccountIds(
  tx: TenantTx,
  tenantId: string,
): Promise<Map<string, string>> {
  await ensureAccountDefaults(tx, tenantId);
  return new Map(
    (await repo.listAccounts(tx)).filter((a) => a.isSystem).map((a) => [a.code, a.id]),
  );
}

/** Writes one balanced entry. The database refuses to commit it if it is not balanced. */
export async function postEntry(
  tx: TenantTx,
  userId: string,
  tenantId: string,
  e: EntryInput,
  ids: Map<string, string>,
): Promise<string> {
  const lines = e.lines
    .filter((l) => l.debit > 0n || l.credit > 0n)
    .map((l) => {
      const accountId = typeof l.account === 'string' ? ids.get(l.account) : l.account.id;
      if (!accountId) {
        throw new BusinessRuleError(
          `The system account ${String(l.account)} is missing. Add it in the chart of accounts.`,
        );
      }
      return { accountId, debit: paiseToString(l.debit), credit: paiseToString(l.credit) };
    });
  const entryId = await repo.insertEntry(tx, {
    tenantId,
    number: await repo.nextNumber(tx, tenantId, 'JE'),
    entryDate: e.entryDate,
    memo: e.memo,
    sourceType: e.sourceType,
    sourceId: e.sourceId,
    branchId: e.branchId,
    reversalOf: e.reversalOf ?? null,
    createdBy: userId,
  });
  await repo.insertJournalLines(tx, tenantId, entryId, lines);
  return entryId;
}

/** The same lines with debit and credit swapped. An entry can be reversed once. */
export async function reverseEntry(
  tx: TenantTx,
  userId: string,
  tenantId: string,
  original: { id: string; branchId: string | null },
  memo: string,
  entryDate: string,
): Promise<string> {
  const lines = (await repo.entryLines(tx, original.id)).map((l) => ({
    account: { id: l.account.id },
    debit: parsePaise(l.credit),
    credit: parsePaise(l.debit),
  }));
  try {
    return await postEntry(
      tx,
      userId,
      tenantId,
      {
        entryDate,
        memo,
        sourceType: 'reversal',
        sourceId: original.id,
        branchId: original.branchId,
        reversalOf: original.id,
        lines,
      },
      new Map(),
    );
  } catch (error) {
    if (isUniqueViolation(error, 'journal_entries_reversal_once')) {
      throw new BusinessRuleError('This entry has already been reversed');
    }
    throw error;
  }
}
