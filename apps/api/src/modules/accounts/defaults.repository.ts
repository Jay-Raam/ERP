import { count, eq } from 'drizzle-orm';
import type { TenantTx } from '../../db/client';
import { accounts } from '../../db/schema';

/** The accounts automatic postings use. Their codes are fixed; the names can be read as labels. */
export const SYSTEM_ACCOUNTS = [
  { code: '1000', name: 'Cash in hand', type: 'asset' },
  { code: '1010', name: 'Bank', type: 'asset' },
  { code: '1100', name: 'Accounts receivable', type: 'asset' },
  { code: '1300', name: 'GST input credit', type: 'asset' },
  { code: '2000', name: 'Accounts payable', type: 'liability' },
  { code: '2100', name: 'GST output payable', type: 'liability' },
  { code: '2200', name: 'Salaries payable', type: 'liability' },
  { code: '2210', name: 'Payroll deductions payable', type: 'liability' },
  { code: '3000', name: "Owner's equity", type: 'equity' },
  { code: '4000', name: 'Sales', type: 'income' },
  { code: '5000', name: 'Purchases', type: 'expense' },
  { code: '5100', name: 'Other expenses', type: 'expense' },
  { code: '5200', name: 'Salaries and wages', type: 'expense' },
] as const;

export type SystemCode = (typeof SYSTEM_ACCOUNTS)[number]['code'];

/**
 * Idempotent: adds any system account the organisation is missing, so organisations created
 * before a new posting rule existed pick up its accounts. Safe at registration, in the seed,
 * and lazily. An existing account with the same code is left alone.
 */
export async function ensureAccountDefaults(tx: TenantTx, tenantId: string): Promise<void> {
  const [row] = await tx.select({ n: count() }).from(accounts).where(eq(accounts.isSystem, true));
  if ((row?.n ?? 0) >= SYSTEM_ACCOUNTS.length) return;
  await tx
    .insert(accounts)
    .values(SYSTEM_ACCOUNTS.map((a) => ({ tenantId, ...a, isSystem: true })))
    .onConflictDoNothing();
}
