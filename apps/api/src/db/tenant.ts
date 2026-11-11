import { eq, sql } from 'drizzle-orm';
import type { Database, TenantTx } from './client';
import { organisations } from './schema';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The only way application code reaches the database.
 *
 * Opens a transaction, drops to the restricted erp_app role and pins the
 * tenant. Both settings are transaction-local, so they can never leak to the
 * next request that reuses the pooled connection. Row-level security then
 * limits every statement in `fn` to this tenant's rows.
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (!UUID.test(tenantId)) {
    // A programming error, not user input: fail loudly instead of running unscoped.
    throw new Error('withTenant: tenantId must be a UUID');
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE erp_app`);
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/**
 * Resolves an organisation ID (slug) to its tenant, before any tenant context
 * exists. The slug_lookup policy exposes exactly that one row to this
 * transaction; every other tenant stays invisible.
 */
export async function findTenantBySlug(
  db: Database,
  slug: string,
): Promise<{ id: string; status: 'active' | 'inactive' } | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE erp_app`);
    await tx.execute(sql`SELECT set_config('app.lookup_slug', ${slug}, true)`);
    const [row] = await tx
      .select({ id: organisations.id, status: organisations.status })
      .from(organisations)
      .where(eq(organisations.slug, slug))
      .limit(1);
    return row ?? null;
  });
}
