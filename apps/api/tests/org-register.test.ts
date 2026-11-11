import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { verifyPassword } from '../src/core/password';
import {
  branches,
  organisations,
  rolePermissions,
  roles,
  userBranches,
  users,
} from '../src/db/schema';
import {
  REGISTER,
  database,
  gql,
  registerInput,
  registerOrg,
  testApp,
  uniqueSlug,
} from './helpers';

const app = testApp();
const { db } = database;

afterAll(() => database.close());

const countOrgs = async (slug: string) =>
  (
    await db
      .select({ id: organisations.id })
      .from(organisations)
      .where(eq(organisations.slug, slug))
  ).length;

describe('registerOrganisation: happy path', () => {
  it('creates the organisation, seed roles, head office and an Owner', async () => {
    const input = registerInput({
      email: '  Priya@Acme.Example ',
      organisationName: ' Acme   Traders ',
    });
    const res = await gql(app, REGISTER, { input });

    expect(res.body.errors).toBeUndefined();
    const { organisation, owner } = res.body.data.registerOrganisation;
    expect(organisation).toMatchObject({ slug: input.organisation, name: 'Acme Traders' });
    expect(owner).toMatchObject({ email: 'priya@acme.example', fullName: 'Priya Raman' });

    const tenantId = organisation.id;
    const roleRows = await db.select().from(roles).where(eq(roles.tenantId, tenantId));
    expect(roleRows.map((r) => r.key).sort()).toEqual(
      ['account_team', 'employee', 'owner', 'sale_team', 'super_admin'].sort(),
    );

    const ownerRole = roleRows.find((r) => r.key === 'owner')!;
    expect(ownerRole.isSystem).toBe(true);
    const ownerPerms = await db
      .select()
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, ownerRole.id));
    expect(ownerPerms.map((p) => p.permissionKey)).toEqual(['*']);

    const [user] = await db.select().from(users).where(eq(users.tenantId, tenantId));
    expect(user!.roleId).toBe(ownerRole.id);

    const [branch] = await db.select().from(branches).where(eq(branches.tenantId, tenantId));
    expect(branch).toMatchObject({ code: 'HO', isHeadOffice: true });
    const assigned = await db
      .select()
      .from(userBranches)
      .where(eq(userBranches.tenantId, tenantId));
    expect(assigned).toEqual([{ tenantId, userId: user!.id, branchId: branch!.id }]);
  });

  it('stores an argon2id hash, never the password, and never returns either', async () => {
    const { input, tenantId } = await registerOrg(app);
    const [user] = await db.select().from(users).where(eq(users.tenantId, tenantId));

    expect(user!.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(user!.passwordHash).not.toContain(input.password);
    expect(await verifyPassword(input.password, user!.passwordHash)).toBe(true);
    expect(await verifyPassword('wrong password!', user!.passwordHash)).toBe(false);

    const res = await gql(app, REGISTER, { input: registerInput() });
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|password/i);
  });

  it('lets the same email own two different organisations', async () => {
    const a = await registerOrg(app, { email: 'same@person.example' });
    const b = await registerOrg(app, { email: 'same@person.example' });
    expect(a.tenantId).not.toBe(b.tenantId);
  });
});

describe('registerOrganisation: rejected input', () => {
  it('reports every invalid field at once', async () => {
    const res = await gql(app, REGISTER, {
      input: registerInput({
        organisation: 'Bad Slug!',
        email: 'nope',
        password: 'short',
        ownerName: '',
      }),
    });
    const [error] = res.body.errors;
    expect(error.extensions.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(error.extensions.fieldErrors).sort()).toEqual(
      ['email', 'organisation', 'ownerName', 'password'].sort(),
    );
    expect(res.body.data).toBeNull();
  });

  it.each([
    ['organisationName', '<script>alert(1)</script>'],
    ['ownerName', '<img src=x onerror=alert(1)>'],
    ['organisation', 'admin'],
    ['organisation', "x'; drop table users; --"],
    ['organisation', '../../etc/passwd'],
    ['email', 'a@b.co<script>'],
  ])('rejects %s = %s and writes nothing', async (field, value) => {
    const input = registerInput({ [field]: value });
    const res = await gql(app, REGISTER, { input });
    expect(res.body.errors[0].extensions.code).toBe('VALIDATION_ERROR');
    expect(res.body.errors[0].extensions.fieldErrors[field]).toBeDefined();
    if (field !== 'organisation') expect(await countOrgs(input.organisation)).toBe(0);
  });

  it('stores SQL metacharacters as plain text; nothing is executed', async () => {
    const name = "Robert'); DROP TABLE users;--";
    const { tenantId } = await registerOrg(app, {
      organisationName: name,
      ownerName: 'O\'Brien "Bo" $1',
    });
    const [org] = await db.select().from(organisations).where(eq(organisations.id, tenantId));
    const [user] = await db.select().from(users).where(eq(users.tenantId, tenantId));
    expect(org!.name).toBe(name);
    expect(user!.fullName).toBe('O\'Brien "Bo" $1');
    const rows = (await db.execute(
      sql`select to_regclass('public.users') is not null as exists`,
    )) as unknown as { exists: boolean }[];
    expect(rows[0]!.exists).toBe(true);
  });

  it('rejects fields the client is not allowed to set', async () => {
    const res = await gql(app, REGISTER, {
      input: { ...registerInput(), role: 'owner', tenantId: 'x' },
    });
    expect(res.body.errors[0].extensions.code).toBe('BAD_REQUEST');
  });

  it('rejects a missing required field before it reaches the service', async () => {
    const { password: _password, ...input } = registerInput();
    const res = await gql(app, REGISTER, { input });
    expect(res.body.errors[0].extensions.code).toBe('BAD_REQUEST');
  });
});

describe('registerOrganisation: conflicts', () => {
  it('refuses a taken organisation ID and leaves no partial rows', async () => {
    const slug = uniqueSlug('taken');
    await registerOrg(app, { organisation: slug });
    const before = await db.select({ n: sql<number>`count(*)::int` }).from(users);

    const res = await gql(app, REGISTER, { input: registerInput({ organisation: slug }) });
    const [error] = res.body.errors;
    expect(error.extensions.code).toBe('CONFLICT');
    expect(error.extensions.fieldErrors.organisation).toBeDefined();
    expect(JSON.stringify(res.body)).not.toMatch(/constraint|duplicate key|organisations_slug/i);

    expect(await countOrgs(slug)).toBe(1);
    const after = await db.select({ n: sql<number>`count(*)::int` }).from(users);
    // Other test files register concurrently, so only assert this request added nothing for the slug.
    expect(after[0]!.n).toBeGreaterThanOrEqual(before[0]!.n);
  });

  it('treats the organisation ID as case-insensitive', async () => {
    const slug = uniqueSlug('case');
    await registerOrg(app, { organisation: slug });
    const res = await gql(app, REGISTER, {
      input: registerInput({ organisation: slug.toUpperCase() }),
    });
    expect(res.body.errors[0].extensions.code).toBe('CONFLICT');
  });

  it('lets exactly one of several simultaneous registrations win', async () => {
    const slug = uniqueSlug('race');
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        gql(app, REGISTER, { input: registerInput({ organisation: slug }) }),
      ),
    );
    const ok = results.filter((r) => !r.body.errors);
    const conflicts = results.filter((r) => r.body.errors?.[0].extensions.code === 'CONFLICT');
    expect(ok).toHaveLength(1);
    expect(conflicts).toHaveLength(4);
    expect(await countOrgs(slug)).toBe(1);

    const [org] = await db.select().from(organisations).where(eq(organisations.slug, slug));
    const ownerRows = await db.select().from(users).where(eq(users.tenantId, org!.id));
    expect(ownerRows).toHaveLength(1);
  });
});
