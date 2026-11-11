import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { roles, users } from '../src/db/schema';
import { CLIENT, database, gql, registerOrg, signIn, testApp } from './helpers';

const app = testApp();
const { db } = database;
afterAll(() => database.close());

type Agent = ReturnType<typeof request.agent>;
const q = (agent: Agent, query: string, variables?: Record<string, unknown>) =>
  agent.post('/graphql').set(CLIENT).send({ query, variables });
const code = (res: request.Response) => res.body.errors?.[0]?.extensions?.code as string;

const ROLES = `{ roles { id key name isSystem permissions userCount version dataScope } }`;
const BRANCHES = `{ branches { id code name isHeadOffice status version } }`;
const USERS = `query($i: ListUsersInput){ users(input:$i){ total items { id email fullName status version role { id key } branches { id code } } } }`;
const CREATE_ROLE = `mutation($i: RoleInput!){ createRole(input:$i){ id key name permissions version } }`;
const UPDATE_ROLE = `mutation($id: ID!, $i: UpdateRoleInput!){ updateRole(id:$id,input:$i){ id name permissions version } }`;
const DELETE_ROLE = `mutation($id: ID!){ deleteRole(id:$id) }`;
const CREATE_BRANCH = `mutation($i: CreateBranchInput!){ createBranch(input:$i){ id code name status version } }`;
const UPDATE_BRANCH = `mutation($id: ID!, $i: UpdateBranchInput!){ updateBranch(id:$id,input:$i){ id name status version } }`;
const CREATE_USER = `mutation($i: CreateUserInput!){ createUser(input:$i){ id email status version role { key } branches { code } } }`;
const UPDATE_USER = `mutation($id: ID!, $i: UpdateUserInput!){ updateUser(id:$id,input:$i){ id fullName status version role { key } branches { code } } }`;
const RESET = `mutation($id: ID!, $p: String!){ resetUserPassword(id:$id,password:$p) }`;
const ME_ID = `{ me { user { id } } }`;

type Org = Awaited<ReturnType<typeof registerOrg>>;
let a: Org;
let owner: Agent;
let roleIds: Record<string, string>;
let headOffice: string;

async function setup(org: Org) {
  const { agent } = await signIn(app, org);
  const rs = (await q(agent, ROLES)).body.data.roles as { id: string; key: string }[];
  const bs = (await q(agent, BRANCHES)).body.data.branches as { id: string }[];
  return { agent, roleIds: Object.fromEntries(rs.map((r) => [r.key, r.id])), branchId: bs[0]!.id };
}

let seq = 0;
/** Creates a user with the given role through the API and returns a signed-in agent for them. */
async function userWithRole(roleKey: string, branches: string[] = [headOffice]) {
  const email = `u${++seq}-${Math.random().toString(36).slice(2, 8)}@acme.example`;
  const password = 'a long enough password';
  const res = await q(owner, CREATE_USER, {
    i: { fullName: 'Test User', email, password, roleId: roleIds[roleKey], branchIds: branches },
  });
  expect(res.body.errors).toBeUndefined();
  const { agent } = await signIn(app, { input: { ...a.input, email, password } });
  return { id: res.body.data.createUser.id as string, email, password, agent };
}

beforeAll(async () => {
  a = await registerOrg(app, { email: 'owner@a.example' });
  const s = await setup(a);
  owner = s.agent;
  roleIds = s.roleIds;
  headOffice = s.branchId;
});

describe('access control', () => {
  it('rejects anonymous callers', async () => {
    for (const query of [ROLES, BRANCHES, USERS]) {
      expect(code(await gql(app, query))).toBe('UNAUTHENTICATED');
    }
  });

  it('forbids a plain Employee from every admin query and mutation', async () => {
    const { agent } = await userWithRole('employee');
    for (const query of [ROLES, BRANCHES, USERS]) {
      expect(code(await q(agent, query))).toBe('FORBIDDEN');
    }
    const attempts = [
      q(agent, CREATE_ROLE, { i: { name: 'X Role', dataScope: 'own', permissions: [] } }),
      q(agent, CREATE_BRANCH, { i: { code: 'ZZ', name: 'Zed' } }),
      q(agent, RESET, { id: a.ownerId, p: 'another long password' }),
    ];
    for (const res of await Promise.all(attempts)) expect(code(res)).toBe('FORBIDDEN');
  });

  it('lets the Owner see all five seed roles and the head office', async () => {
    const res = await q(owner, ROLES);
    expect(res.body.data.roles.map((r: { key: string }) => r.key).sort()).toEqual(
      ['account_team', 'employee', 'owner', 'sale_team', 'super_admin'].sort(),
    );
    const branches = (await q(owner, BRANCHES)).body.data.branches;
    expect(branches[0]).toMatchObject({ code: 'HO', isHeadOffice: true });
  });

  it('serves the permission catalogue to those who can view roles', async () => {
    const res = await q(owner, `{ permissionCatalogue { key module label } }`);
    expect(res.body.data.permissionCatalogue.length).toBeGreaterThan(10);
    const { agent } = await userWithRole('employee');
    expect(code(await q(agent, `{ permissionCatalogue { key } }`))).toBe('FORBIDDEN');
  });
});

describe('roles', () => {
  it('creates, edits and deletes a custom role', async () => {
    const created = await q(owner, CREATE_ROLE, {
      i: { name: 'Store Keeper', dataScope: 'branch', permissions: ['store.*.*', 'store.*.*'] },
    });
    expect(created.body.errors).toBeUndefined();
    const role = created.body.data.createRole;
    expect(role).toMatchObject({ key: 'store_keeper', permissions: ['store.*.*'], version: 1 });

    const updated = await q(owner, UPDATE_ROLE, {
      id: role.id,
      i: { name: 'Store Lead', dataScope: 'branch', permissions: ['store.*.view'], version: 1 },
    });
    expect(updated.body.data.updateRole).toMatchObject({
      name: 'Store Lead',
      permissions: ['store.*.view'],
      version: 2,
    });

    expect(code(await q(owner, DELETE_ROLE, { id: role.id }))).toBeUndefined();
    const left = (await q(owner, ROLES)).body.data.roles.map((r: { id: string }) => r.id);
    expect(left).not.toContain(role.id);
  });

  it('refuses a duplicate role name', async () => {
    const i = { name: 'Auditor', dataScope: 'organisation', permissions: [] };
    await q(owner, CREATE_ROLE, { i });
    const res = await q(owner, CREATE_ROLE, { i });
    expect(code(res)).toBe('CONFLICT');
    expect(res.body.errors[0].extensions.fieldErrors.name).toBeDefined();
  });

  it('rejects markup, unknown permission formats and unknown fields', async () => {
    const bad = [
      { name: '<b>x</b>', dataScope: 'own', permissions: [] },
      { name: 'Fine Name', dataScope: 'own', permissions: ['not a permission'] },
      { name: 'Fine Name', dataScope: 'own', permissions: ['sale.invoice'] },
    ];
    for (const i of bad) expect(code(await q(owner, CREATE_ROLE, { i }))).toBe('VALIDATION_ERROR');
    const extra = await q(owner, CREATE_ROLE, {
      i: { name: 'Fine Name', dataScope: 'own', permissions: [], isSystem: true },
    });
    expect(extra.body.errors).toBeDefined();
  });

  it('never lets the Owner role be edited or deleted', async () => {
    const edit = await q(owner, UPDATE_ROLE, {
      id: roleIds.owner,
      i: { name: 'Owner', dataScope: 'own', permissions: [], version: 1 },
    });
    expect(code(edit)).toBe('BUSINESS_RULE');
    expect(code(await q(owner, DELETE_ROLE, { id: roleIds.owner }))).toBe('BUSINESS_RULE');
  });

  it('blocks deleting a role that still has users', async () => {
    await userWithRole('sale_team');
    const res = await q(owner, DELETE_ROLE, { id: roleIds.sale_team });
    expect(code(res)).toBe('BUSINESS_RULE');
    expect(res.body.errors[0].message).toMatch(/still on this role/);
  });

  it('detects a stale edit with the version counter', async () => {
    const { body } = await q(owner, CREATE_ROLE, {
      i: { name: 'Stale Test', dataScope: 'own', permissions: [] },
    });
    const role = body.data.createRole;
    const edit = (version: number) =>
      q(owner, UPDATE_ROLE, {
        id: role.id,
        i: { name: 'Stale Test 2', dataScope: 'own', permissions: [], version },
      });
    expect((await edit(1)).body.errors).toBeUndefined();
    expect(code(await edit(1))).toBe('CONFLICT');
  });

  it('applies changes to a role on the very next request', async () => {
    const roleRes = await q(owner, CREATE_ROLE, {
      i: { name: 'Viewer Only', dataScope: 'organisation', permissions: ['branch.branch.view'] },
    });
    const role = roleRes.body.data.createRole;
    const email = `live-${Math.random().toString(36).slice(2, 8)}@acme.example`;
    await q(owner, CREATE_USER, {
      i: {
        fullName: 'Live Perm',
        email,
        password: 'a long enough password',
        roleId: role.id,
        branchIds: [headOffice],
      },
    });
    const { agent } = await signIn(app, {
      input: { ...a.input, email, password: 'a long enough password' },
    });
    expect(code(await q(agent, BRANCHES))).toBeUndefined();
    expect(code(await q(agent, ROLES))).toBe('FORBIDDEN');

    await q(owner, UPDATE_ROLE, {
      id: role.id,
      i: {
        name: 'Viewer Only',
        dataScope: 'organisation',
        permissions: ['rbac.role.view'],
        version: 1,
      },
    });
    expect(code(await q(agent, BRANCHES))).toBe('FORBIDDEN');
    expect(code(await q(agent, ROLES))).toBeUndefined();
  });
});

describe('privilege escalation', () => {
  it('stops a Super Admin granting more than they hold', async () => {
    const admin = await userWithRole('super_admin');
    const tooMuch = ['sale.*.*', 'accounts.*.*', '*', 'payroll.run.approve'];
    for (const permission of tooMuch) {
      const res = await q(admin.agent, CREATE_ROLE, {
        i: {
          name: `Try ${permission}`.replace(/[^a-z ]/gi, ''),
          dataScope: 'own',
          permissions: [permission],
        },
      });
      expect(code(res), permission).toBe('FORBIDDEN');
    }
    // What they hold they may grant, including narrower slices of a wildcard.
    const ok = await q(admin.agent, CREATE_ROLE, {
      i: {
        name: 'Sale Viewers',
        dataScope: 'own',
        permissions: ['sale.*.view', 'sale.invoice.view'],
      },
    });
    expect(ok.body.errors).toBeUndefined();
  });

  it('stops a Super Admin assigning or touching the Owner role', async () => {
    const admin = await userWithRole('super_admin');
    const make = await q(admin.agent, CREATE_USER, {
      i: {
        fullName: 'Sneaky',
        email: `sneaky-${Math.random().toString(36).slice(2, 8)}@acme.example`,
        password: 'a long enough password',
        roleId: roleIds.owner,
        branchIds: [headOffice],
      },
    });
    expect(code(make)).toBe('FORBIDDEN');

    // Nor may they edit, deactivate or reset the password of an Owner.
    const target = (await q(owner, USERS, { i: { search: 'owner@a.example' } })).body.data.users
      .items[0];
    const edit = await q(admin.agent, UPDATE_USER, {
      id: target.id,
      i: {
        fullName: 'Hijacked',
        roleId: roleIds.employee,
        branchIds: [headOffice],
        status: 'active',
        version: target.version,
      },
    });
    expect(code(edit)).toBe('FORBIDDEN');
    expect(code(await q(admin.agent, RESET, { id: target.id, p: 'another long password' }))).toBe(
      'FORBIDDEN',
    );
  });

  it('stops a Super Admin editing or deleting a role above their reach', async () => {
    const admin = await userWithRole('super_admin');
    const accountTeam = (await q(owner, ROLES)).body.data.roles.find(
      (r: { key: string }) => r.key === 'account_team',
    );
    const edit = await q(admin.agent, UPDATE_ROLE, {
      id: accountTeam.id,
      i: { name: 'Account team', dataScope: 'own', permissions: [], version: accountTeam.version },
    });
    expect(code(edit)).toBe('FORBIDDEN');
  });
});

describe('branches', () => {
  it('creates a branch, uppercases the code and refuses duplicates', async () => {
    const res = await q(owner, CREATE_BRANCH, { i: { code: 'chn-1', name: 'Chennai One' } });
    expect(res.body.data.createBranch).toMatchObject({ code: 'CHN-1', status: 'active' });
    const dup = await q(owner, CREATE_BRANCH, { i: { code: 'CHN-1', name: 'Again' } });
    expect(code(dup)).toBe('CONFLICT');
    expect(dup.body.errors[0].extensions.fieldErrors.code).toBeDefined();
  });

  it('validates the code and name', async () => {
    for (const i of [
      { code: 'a', name: 'Short' },
      { code: 'has space', name: 'Bad Code' },
      { code: 'OK1', name: '<script>' },
    ]) {
      expect(code(await q(owner, CREATE_BRANCH, { i }))).toBe('VALIDATION_ERROR');
    }
  });

  it('keeps the head office active', async () => {
    const [ho] = (await q(owner, BRANCHES)).body.data.branches;
    const res = await q(owner, UPDATE_BRANCH, {
      id: ho.id,
      i: { name: ho.name, status: 'inactive', version: ho.version },
    });
    expect(code(res)).toBe('BUSINESS_RULE');
  });

  it('renames and deactivates with optimistic locking, and blocks inactive branches for users', async () => {
    const created = (await q(owner, CREATE_BRANCH, { i: { code: 'MDU', name: 'Madurai' } })).body
      .data.createBranch;
    const upd = await q(owner, UPDATE_BRANCH, {
      id: created.id,
      i: { name: 'Madurai Hub', status: 'inactive', version: created.version },
    });
    expect(upd.body.data.updateBranch).toMatchObject({
      name: 'Madurai Hub',
      status: 'inactive',
      version: 2,
    });
    const stale = await q(owner, UPDATE_BRANCH, {
      id: created.id,
      i: { name: 'Madurai Hub', status: 'active', version: 1 },
    });
    expect(code(stale)).toBe('CONFLICT');

    const user = await q(owner, CREATE_USER, {
      i: {
        fullName: 'Branch Test',
        email: 'branch-test@acme.example',
        password: 'a long enough password',
        roleId: roleIds.employee,
        branchIds: [created.id],
      },
    });
    expect(code(user)).toBe('VALIDATION_ERROR');
    expect(user.body.errors[0].extensions.fieldErrors.branchIds).toBeDefined();
  });
});

describe('users', () => {
  const base = () => ({
    fullName: 'Kavya Nair',
    email: `kavya-${Math.random().toString(36).slice(2, 8)}@acme.example`,
    password: 'a long enough password',
    roleId: roleIds.employee,
    branchIds: [headOffice],
  });

  it('creates a user who can sign in with the role and branches given', async () => {
    const input = { ...base(), email: '  Kavya.N@Acme.Example ' };
    const res = await q(owner, CREATE_USER, { i: input });
    expect(res.body.data.createUser).toMatchObject({
      email: 'kavya.n@acme.example',
      status: 'active',
      role: { key: 'employee' },
      branches: [{ code: 'HO' }],
    });
    const { agent } = await signIn(app, {
      input: { ...a.input, email: 'kavya.n@acme.example', password: input.password },
    });
    const me = await q(agent, `{ me { role { key } branches { code } } }`);
    expect(me.body.data.me).toEqual({ role: { key: 'employee' }, branches: [{ code: 'HO' }] });
  });

  it('never returns or stores the password in clear text', async () => {
    const input = base();
    const res = await q(owner, CREATE_USER, { i: input });
    expect(JSON.stringify(res.body)).not.toContain(input.password);
    const [row] = await db.select().from(users).where(eq(users.id, res.body.data.createUser.id));
    expect(row!.passwordHash).toMatch(/^\$argon2id\$/);
  });

  it('refuses duplicate emails, weak passwords and bad references', async () => {
    const input = base();
    await q(owner, CREATE_USER, { i: input });
    const dup = await q(owner, CREATE_USER, { i: { ...input, email: input.email.toUpperCase() } });
    expect(code(dup)).toBe('CONFLICT');

    const cases: [Record<string, unknown>, string][] = [
      [{ ...base(), password: 'short' }, 'password'],
      [{ ...base(), email: 'not-an-email' }, 'email'],
      [{ ...base(), fullName: '<img src=x>' }, 'fullName'],
      [{ ...base(), branchIds: [] }, 'branchIds'],
      [{ ...base(), roleId: 'nope' }, 'roleId'],
    ];
    for (const [i, field] of cases) {
      const res = await q(owner, CREATE_USER, { i });
      expect(code(res), field).toBe('VALIDATION_ERROR');
      expect(res.body.errors[0].extensions.fieldErrors[field], field).toBeDefined();
    }
    const unknownRole = await q(owner, CREATE_USER, {
      i: { ...base(), roleId: '11111111-1111-4111-8111-111111111111' },
    });
    expect(code(unknownRole)).toBe('VALIDATION_ERROR');
  });

  it('counts the users on each role', async () => {
    const u = await userWithRole('sale_team');
    const rolesNow = (await q(owner, ROLES)).body.data.roles as {
      key: string;
      userCount: number;
    }[];
    expect(rolesNow.find((r) => r.key === 'sale_team')!.userCount).toBeGreaterThanOrEqual(1);
    expect(rolesNow.find((r) => r.key === 'owner')!.userCount).toBe(1);
    expect(u.id).toBeTruthy();
  });

  it('lists with search, status filter and paging; searches literally', async () => {
    const tag = Math.random().toString(36).slice(2, 8);
    for (const n of ['Alpha', 'Beta', 'Gamma']) {
      await q(owner, CREATE_USER, {
        i: { ...base(), fullName: `${n} ${tag}`, email: `${n.toLowerCase()}-${tag}@acme.example` },
      });
    }
    const search = (await q(owner, USERS, { i: { search: tag, limit: 2 } })).body.data.users;
    expect(search.total).toBe(3);
    expect(search.items.map((u: { fullName: string }) => u.fullName)).toEqual([
      `Alpha ${tag}`,
      `Beta ${tag}`,
    ]);
    const page2 = (await q(owner, USERS, { i: { search: tag, limit: 2, offset: 2 } })).body.data
      .users;
    expect(page2.items).toHaveLength(1);
    // % must not act as a wildcard.
    expect((await q(owner, USERS, { i: { search: '%' } })).body.data.users.total).toBe(0);
    expect(code(await q(owner, USERS, { i: { limit: 1000 } }))).toBe('VALIDATION_ERROR');
    expect(
      (await q(owner, USERS, { i: { status: 'inactive' } })).body.data.users.total,
    ).toBeGreaterThanOrEqual(0);
  });

  it('treats null filters (what the web app sends) as not set', async () => {
    const res = await q(owner, USERS, {
      i: { search: null, status: null, limit: null, offset: null },
    });
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.users.total).toBeGreaterThan(0);
  });

  it('changes role, name and branches and applies it immediately', async () => {
    const { id, agent } = await userWithRole('employee');
    const extra = (await q(owner, CREATE_BRANCH, { i: { code: `X${seq}`, name: 'Extra Branch' } }))
      .body.data.createBranch;
    const [current] = (await q(owner, USERS, { i: { limit: 100 } })).body.data.users.items.filter(
      (u: { id: string }) => u.id === id,
    );
    expect(code(await q(agent, BRANCHES))).toBe('FORBIDDEN');
    const res = await q(owner, UPDATE_USER, {
      id,
      i: {
        fullName: 'Renamed Person',
        roleId: roleIds.super_admin,
        branchIds: [headOffice, extra.id],
        status: 'active',
        version: current.version,
      },
    });
    expect(res.body.data.updateUser).toMatchObject({
      fullName: 'Renamed Person',
      role: { key: 'super_admin' },
      version: current.version + 1,
    });
    expect(res.body.data.updateUser.branches).toHaveLength(2);
    expect(code(await q(agent, BRANCHES))).toBeUndefined();
  });

  it('detects stale user edits', async () => {
    const { id } = await userWithRole('employee');
    const edit = (version: number) =>
      q(owner, UPDATE_USER, {
        id,
        i: {
          fullName: 'Same Person',
          roleId: roleIds.employee,
          branchIds: [headOffice],
          status: 'active',
          version,
        },
      });
    expect((await edit(1)).body.errors).toBeUndefined();
    expect(code(await edit(1))).toBe('CONFLICT');
  });

  it('signs a deactivated user out at once and refuses their login', async () => {
    const victim = await userWithRole('employee');
    expect((await q(victim.agent, ME_ID)).body.errors).toBeUndefined();
    const res = await q(owner, UPDATE_USER, {
      id: victim.id,
      i: {
        fullName: 'Test User',
        roleId: roleIds.employee,
        branchIds: [headOffice],
        status: 'inactive',
        version: 1,
      },
    });
    expect(res.body.errors).toBeUndefined();
    expect(code(await q(victim.agent, ME_ID))).toBe('UNAUTHENTICATED');
    const login = await request(app)
      .post('/auth/login')
      .set(CLIENT)
      .send({ organisation: a.input.organisation, email: victim.email, password: victim.password });
    expect(login.status).toBe(401);
  });

  it('stops you changing your own role or deactivating yourself', async () => {
    const me = (await q(owner, USERS, { i: { search: 'owner@a.example' } })).body.data.users
      .items[0];
    for (const change of [
      { status: 'inactive', roleId: me.role.id },
      { status: 'active', roleId: roleIds.employee },
    ]) {
      const res = await q(owner, UPDATE_USER, {
        id: me.id,
        i: { fullName: 'Priya Raman', branchIds: [headOffice], version: me.version, ...change },
      });
      expect(code(res)).toBe('BUSINESS_RULE');
    }
    expect(code(await q(owner, RESET, { id: me.id, p: 'another long password' }))).toBe(
      'BUSINESS_RULE',
    );
  });

  it('resets a password, ends their sessions and accepts only the new one', async () => {
    const target = await userWithRole('employee');
    const res = await q(owner, RESET, { id: target.id, p: 'brand new password' });
    expect(res.body.data.resetUserPassword).toBe(true);
    expect(code(await q(target.agent, ME_ID))).toBe('UNAUTHENTICATED');
    const login = (password: string) =>
      request(app)
        .post('/auth/login')
        .set(CLIENT)
        .send({ organisation: a.input.organisation, email: target.email, password });
    expect((await login(target.password)).status).toBe(401);
    expect((await login('brand new password')).status).toBe(200);
    expect(code(await q(owner, RESET, { id: target.id, p: 'short' }))).toBe('VALIDATION_ERROR');
  });
});

describe('last Owner protection', () => {
  it('leaves at least one active Owner when two Owners remove each other at once', async () => {
    const org = await registerOrg(app, { email: 'owner@race.example' });
    const first = await setup(org);
    const email = 'second@race.example';
    const password = 'a long enough password';
    const made = await q(first.agent, CREATE_USER, {
      i: {
        fullName: 'Second Owner',
        email,
        password,
        roleId: first.roleIds.owner,
        branchIds: [first.branchId],
      },
    });
    expect(made.body.errors).toBeUndefined();
    const secondId = made.body.data.createUser.id as string;
    const { agent: second } = await signIn(app, { input: { ...org.input, email, password } });

    const deactivate = (agent: Agent, id: string) =>
      q(agent, UPDATE_USER, {
        id,
        i: {
          fullName: 'Owner',
          roleId: first.roleIds.owner,
          branchIds: [first.branchId],
          status: 'inactive',
          version: 1,
        },
      });
    await Promise.all([deactivate(first.agent, secondId), deactivate(second, org.ownerId)]);

    const owners = await db.select().from(users).where(eq(users.tenantId, org.tenantId));
    expect(owners.filter((u) => u.status === 'active').length).toBeGreaterThanOrEqual(1);
  });
});

describe('tenant isolation', () => {
  it("cannot see or touch another organisation's data", async () => {
    const b = await registerOrg(app, { email: 'owner@b.example' });
    const other = await setup(b);

    const mine = (await q(owner, USERS, { i: { limit: 100 } })).body.data.users.items as {
      id: string;
      version: number;
    }[];
    const theirs = (await q(other.agent, USERS)).body.data.users;
    expect(theirs.total).toBe(1);
    expect(mine.map((u) => u.id)).not.toContain(theirs.items[0].id);

    // Using A's ids from B fails as if they did not exist.
    const victim = mine[0]!;
    const edit = await q(other.agent, UPDATE_USER, {
      id: victim.id,
      i: {
        fullName: 'Hijack',
        roleId: other.roleIds.employee,
        branchIds: [other.branchId],
        status: 'inactive',
        version: victim.version,
      },
    });
    expect(code(edit)).toBe('NOT_FOUND');
    expect(code(await q(other.agent, RESET, { id: victim.id, p: 'another long password' }))).toBe(
      'NOT_FOUND',
    );
    expect(code(await q(other.agent, DELETE_ROLE, { id: roleIds.employee }))).toBe('NOT_FOUND');

    const crossRole = await q(other.agent, CREATE_USER, {
      i: {
        fullName: 'Cross Tenant',
        email: 'x@b.example',
        password: 'a long enough password',
        roleId: roleIds.employee,
        branchIds: [other.branchId],
      },
    });
    expect(code(crossRole)).toBe('VALIDATION_ERROR');
    const crossBranch = await q(other.agent, CREATE_USER, {
      i: {
        fullName: 'Cross Tenant',
        email: 'x@b.example',
        password: 'a long enough password',
        roleId: other.roleIds.employee,
        branchIds: [headOffice],
      },
    });
    expect(code(crossBranch)).toBe('VALIDATION_ERROR');

    // A's data is untouched.
    const rows = await db.select().from(roles).where(eq(roles.tenantId, a.tenantId));
    expect(rows.length).toBeGreaterThanOrEqual(5);
  });
});
