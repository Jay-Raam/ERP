import type { TenantTx } from '../../db/client';
import { warehouses } from '../../db/schema';
import { countWarehouses, findHeadOffice } from './store.repository';

export const DEFAULT_WAREHOUSE = { code: 'MAIN', name: 'Main store' } as const;

/**
 * Idempotent: gives an organisation with no warehouse a "Main store" at its head office, so
 * stock can be received straight away. Safe at registration, in the seed, and lazily.
 */
export async function ensureStoreDefaults(tx: TenantTx, tenantId: string): Promise<void> {
  if ((await countWarehouses(tx)) > 0) return;
  const head = await findHeadOffice(tx);
  if (!head) return;
  await tx
    .insert(warehouses)
    .values({ tenantId, branchId: head.id, ...DEFAULT_WAREHOUSE })
    .onConflictDoNothing();
}
