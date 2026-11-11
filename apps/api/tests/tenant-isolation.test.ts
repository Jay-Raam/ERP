import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { branches, organisations, roles, users } from '../src/db/schema';
import { withTenant } from '../src/db/tenant';
import { createDatabase } from '../src/db/client';
import { database, registerOrg, testApp } from './helpers';
import { TEST_DATABASE_URL } from './support/test-db';

const app = testApp();
const { db } = database;

let a: Awaited<ReturnType<typeof registerOrg>>;
let b: Awaited<ReturnType<typeof registerOrg>>;

beforeAll(async () => {
  a = await registerOrg(app, { email: 'owner@a.example' });
  b = await registerOrg(app, { email: 'owner@b.example' });
});

afterAll(() => database.close());

describe('row-level security', () => {
  it('shows a tenant only its own rows in every table', async () => {
    const seen = await withTenant(db, a.tenantId, async (tx) => ({
      orgs: await tx.select().from(organisations),
      users: await tx.select().from(users),
      roles: await tx.select().from(roles),
      branches: await tx.select().from(branches),
    }));

    expect(seen.orgs.map((o) => o.id)).toEqual([a.tenantId]);
    expect(seen.users.map((u) => u.id)).toEqual([a.ownerId]);
    expect(seen.roles).toHaveLength(5);
    expect(seen.roles.every((r) => r.tenantId === a.tenantId)).toBe(true);
    expect(seen.branches.every((r) => r.tenantId === a.tenantId)).toBe(true);
  });

  it('returns nothing when asked for another tenant by id', async () => {
    const rows = await withTenant(db, a.tenantId, (tx) =>
      tx.select().from(users).where(eq(users.id, b.ownerId)),
    );
    expect(rows).toEqual([]);
  });

  it('cannot update or delete another tenant’s rows', async () => {
    const result = await withTenant(db, a.tenantId, async (tx) => ({
      updated: await tx
        .update(users)
        .set({ fullName: 'pwned' })
        .where(eq(users.id, b.ownerId))
        .returning(),
      deleted: await tx.delete(branches).where(eq(branches.tenantId, b.tenantId)).returning(),
    }));
    expect(result.updated).toEqual([]);
    expect(result.deleted).toEqual([]);

    const [victim] = await db.select().from(users).where(eq(users.id, b.ownerId));
    expect(victim!.fullName).not.toBe('pwned');
  });

  it('cannot insert a row labelled with another tenant', async () => {
    await expect(
      withTenant(db, a.tenantId, (tx) =>
        tx.insert(branches).values({ tenantId: b.tenantId, code: 'X1', name: 'Planted' }),
      ),
    ).rejects.toThrow();
    const planted = await db.select().from(branches).where(eq(branches.code, 'X1'));
    expect(planted).toEqual([]);
  });

  it('cannot move its own row into another tenant', async () => {
    await expect(
      withTenant(db, a.tenantId, (tx) =>
        tx.update(users).set({ tenantId: b.tenantId }).where(eq(users.id, a.ownerId)),
      ),
    ).rejects.toThrow();
  });

  it('cannot point its own row at another tenant’s role', async () => {
    const [foreignRole] = await db.select().from(roles).where(eq(roles.tenantId, b.tenantId));
    await expect(
      withTenant(db, a.tenantId, (tx) =>
        tx.update(users).set({ roleId: foreignRole!.id }).where(eq(users.id, a.ownerId)),
      ),
    ).rejects.toThrow();
  });

  it('cannot change the schema or read migration history', async () => {
    await expect(
      withTenant(db, a.tenantId, (tx) =>
        tx.execute(sql`ALTER TABLE users DISABLE ROW LEVEL SECURITY`),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(db, a.tenantId, (tx) => tx.execute(sql`DROP POLICY tenant_isolation ON users`)),
    ).rejects.toThrow();
    await expect(
      withTenant(db, a.tenantId, (tx) =>
        tx.execute(sql`select * from drizzle.__drizzle_migrations`),
      ),
    ).rejects.toThrow();
  });

  it('sees nothing as erp_app when no tenant is set', async () => {
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE erp_app`);
      return tx.select().from(users);
    });
    expect(rows).toEqual([]);
  });

  it('does not leak the tenant or role to the next user of the connection', async () => {
    await withTenant(db, a.tenantId, (tx) => tx.select().from(users));
    const rows = (await db.execute(
      sql`select current_user as role, current_setting('app.tenant_id', true) as tenant`,
    )) as unknown as { role: string; tenant: string | null }[];
    expect(rows[0]!.role).not.toBe('erp_app');
    expect(rows[0]!.tenant ?? '').toBe('');
  });

  it('refuses anything that is not a UUID as a tenant id', async () => {
    for (const bad of ['', 'abc', "' or 1=1 --", `${a.tenantId}' or '1'='1`]) {
      await expect(withTenant(db, bad, (tx) => tx.select().from(users))).rejects.toThrow(/UUID/);
    }
  });
});

/**
 * Production setup: the API logs in as a role that is only a member of erp_app.
 * Then even a statement that resets the role stays inside row-level security.
 */
describe('restricted login role', () => {
  const restrictedUrl = new URL(TEST_DATABASE_URL);
  restrictedUrl.username = 'erp_api_test';
  restrictedUrl.password = 'test_only_password';
  const restricted = createDatabase(restrictedUrl.toString(), { max: 2 });

  beforeAll(async () => {
    await db.execute(sql`
      DO $$ BEGIN
        CREATE ROLE erp_api_test LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'test_only_password' IN ROLE erp_app;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
  });

  afterAll(() => restricted.close());

  it('works normally through withTenant', async () => {
    const rows = await withTenant(restricted.db, a.tenantId, (tx) => tx.select().from(users));
    expect(rows.map((u) => u.id)).toEqual([a.ownerId]);
  });

  it('sees nothing outside withTenant', async () => {
    expect(await restricted.db.select().from(users)).toEqual([]);
    expect(await restricted.db.select().from(organisations)).toEqual([]);
  });

  it('stays confined even if a statement resets the role', async () => {
    const rows = await withTenant(restricted.db, a.tenantId, async (tx) => {
      await tx.execute(sql`RESET ROLE`);
      await tx.execute(sql`SELECT set_config('app.tenant_id', '', true)`);
      return tx.select().from(users);
    });
    expect(rows).toEqual([]);
  });

  it('cannot become the database owner', async () => {
    const owner = new URL(TEST_DATABASE_URL).username;
    await expect(
      withTenant(restricted.db, a.tenantId, (tx) =>
        tx.execute(sql.raw(`SET LOCAL ROLE "${owner}"`)),
      ),
    ).rejects.toThrow();
  });
});

describe('schema guard', () => {
  it('every table has forced row-level security and a tenant policy', async () => {
    const rows = (await db.execute(sql`
      select c.relname as table,
             c.relrowsecurity as enabled,
             c.relforcerowsecurity as forced,
             exists (select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'tenant_isolation') as policy
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by 1
    `)) as unknown as { table: string; enabled: boolean; forced: boolean; policy: boolean }[];

    expect(rows.length).toBeGreaterThanOrEqual(6);
    const unprotected = rows
      .filter((r) => !(r.enabled && r.forced && r.policy))
      .map((r) => r.table);
    // A new table without app_enable_tenant_rls() in its migration fails here.
    expect(unprotected).toEqual([]);
  });

  it('erp_app is not a superuser and cannot bypass RLS', async () => {
    const rows = (await db.execute(
      sql`select rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = 'erp_app'`,
    )) as unknown as { rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean }[];
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcanlogin: false });
  });
});
