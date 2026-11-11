import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { findTenantByEmail } from '../src/db/tenant';
import { database, registerOrg, testApp } from './helpers';

const app = testApp();
afterAll(() => database.close());

const rowsOf = (r: unknown) =>
  (Array.isArray(r) ? r : (r as { rows: unknown[] }).rows) as { email: string }[];

describe('email lookup before sign-in', () => {
  it('finds the tenant that owns an email, and nothing for an unknown one', async () => {
    const a = await registerOrg(app);
    expect(await findTenantByEmail(database.db, a.input.email)).toBe(a.tenantId);
    expect(await findTenantByEmail(database.db, 'nobody-at-all@acme.example')).toBeNull();
  });

  it('exposes only the one matching user row, never the others', async () => {
    const a = await registerOrg(app);
    await registerOrg(app);
    const visible = await database.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE erp_app`);
      await tx.execute(sql`SELECT set_config('app.lookup_email', ${a.input.email}, true)`);
      return tx.execute(sql`SELECT email FROM users`);
    });
    expect(rowsOf(visible).map((r) => r.email)).toEqual([a.input.email]);
  });

  it('exposes nothing without a lookup email', async () => {
    await registerOrg(app);
    const visible = await database.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE erp_app`);
      return tx.execute(sql`SELECT email FROM users`);
    });
    expect(rowsOf(visible)).toEqual([]);
  });
});
