import { and, asc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { TenantTx } from '../../db/client';
import {
  branches,
  refreshTokens,
  rolePermissions,
  roles,
  userBranches,
  users,
} from '../../db/schema';

export type DataScopeValue = 'own' | 'branch' | 'organisation';
export type StatusValue = 'active' | 'inactive';

// ---------------------------------------------------------------- roles

export interface RoleRow {
  id: string;
  key: string;
  name: string;
  dataScope: DataScopeValue;
  isSystem: boolean;
  version: number;
  permissions: string[];
  userCount: number;
}

export async function listRoles(tx: TenantTx): Promise<RoleRow[]> {
  const rows = await tx
    .select({
      id: roles.id,
      key: roles.key,
      name: roles.name,
      dataScope: roles.dataScope,
      isSystem: roles.isSystem,
      version: roles.version,
      // "roles"."id" is written out: a bare ${roles.id} renders unqualified and binds to users.id.
      userCount: sql<number>`(select count(*)::int from ${users} where ${users.roleId} = "roles"."id")`,
    })
    .from(roles)
    .orderBy(asc(roles.isSystem), asc(roles.name));
  const perms = await tx
    .select({ roleId: rolePermissions.roleId, key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .orderBy(asc(rolePermissions.permissionKey));
  const byRole = new Map<string, string[]>();
  for (const p of perms) byRole.set(p.roleId, [...(byRole.get(p.roleId) ?? []), p.key]);
  return rows.map((r) => ({ ...r, permissions: byRole.get(r.id) ?? [] }));
}

export async function findRole(tx: TenantTx, id: string, lock = false) {
  const query = tx
    .select({
      id: roles.id,
      key: roles.key,
      name: roles.name,
      dataScope: roles.dataScope,
      isSystem: roles.isSystem,
      version: roles.version,
    })
    .from(roles)
    .where(eq(roles.id, id))
    .limit(1);
  const [row] = await (lock ? query.for('update') : query);
  return row ?? null;
}

export async function permissionsOfRole(tx: TenantTx, roleId: string): Promise<string[]> {
  const rows = await tx
    .select({ key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, roleId));
  return rows.map((r) => r.key);
}

export async function insertRole(
  tx: TenantTx,
  values: { tenantId: string; key: string; name: string; dataScope: DataScopeValue },
) {
  const [row] = await tx.insert(roles).values(values).returning({ id: roles.id });
  return row!.id;
}

export async function replaceRolePermissions(
  tx: TenantTx,
  tenantId: string,
  roleId: string,
  keys: string[],
) {
  await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
  if (keys.length > 0) {
    await tx
      .insert(rolePermissions)
      .values(keys.map((permissionKey) => ({ tenantId, roleId, permissionKey })));
  }
}

/** Applies the update only when the caller saw the latest version. */
export async function updateRoleRow(
  tx: TenantTx,
  id: string,
  version: number,
  values: { name: string; dataScope: DataScopeValue },
): Promise<boolean> {
  const rows = await tx
    .update(roles)
    .set({ ...values, updatedAt: sql`now()`, version: sql`${roles.version} + 1` })
    .where(and(eq(roles.id, id), eq(roles.version, version)))
    .returning({ id: roles.id });
  return rows.length === 1;
}

export async function deleteRoleRow(tx: TenantTx, id: string) {
  await tx.delete(roles).where(eq(roles.id, id));
}

export async function countUsersWithRole(tx: TenantTx, roleId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(eq(users.roleId, roleId));
  return row!.n;
}

// ------------------------------------------------------------- branches

export async function listBranches(tx: TenantTx) {
  return tx
    .select({
      id: branches.id,
      code: branches.code,
      name: branches.name,
      isHeadOffice: branches.isHeadOffice,
      status: branches.status,
      version: branches.version,
    })
    .from(branches)
    .orderBy(sql`${branches.isHeadOffice} desc`, asc(branches.code));
}

export async function findBranch(tx: TenantTx, id: string, lock = false) {
  const query = tx
    .select({
      id: branches.id,
      code: branches.code,
      name: branches.name,
      isHeadOffice: branches.isHeadOffice,
      status: branches.status,
      version: branches.version,
    })
    .from(branches)
    .where(eq(branches.id, id))
    .limit(1);
  const [row] = await (lock ? query.for('update') : query);
  return row ?? null;
}

export async function insertBranchRow(
  tx: TenantTx,
  values: { tenantId: string; code: string; name: string },
) {
  const [row] = await tx.insert(branches).values(values).returning({ id: branches.id });
  return row!.id;
}

export async function updateBranchRow(
  tx: TenantTx,
  id: string,
  version: number,
  values: { name: string; status: StatusValue },
): Promise<boolean> {
  const rows = await tx
    .update(branches)
    .set({ ...values, updatedAt: sql`now()`, version: sql`${branches.version} + 1` })
    .where(and(eq(branches.id, id), eq(branches.version, version)))
    .returning({ id: branches.id });
  return rows.length === 1;
}

/** Counts how many of these ids are active branches of this tenant. */
export async function countActiveBranches(tx: TenantTx, ids: string[]): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(branches)
    .where(and(inArray(branches.id, ids), eq(branches.status, 'active')));
  return row!.n;
}

// ---------------------------------------------------------------- users

const userColumns = {
  id: users.id,
  email: users.email,
  fullName: users.fullName,
  status: users.status,
  version: users.version,
  createdAt: users.createdAt,
  roleId: roles.id,
  roleKey: roles.key,
  roleName: roles.name,
};

export interface UserRow {
  id: string;
  email: string;
  fullName: string;
  status: StatusValue;
  version: number;
  createdAt: Date;
  role: { id: string; key: string; name: string };
  branches: { id: string; code: string; name: string }[];
}

async function withBranches(
  tx: TenantTx,
  rows: {
    id: string;
    email: string;
    fullName: string;
    status: StatusValue;
    version: number;
    createdAt: Date;
    roleId: string;
    roleKey: string;
    roleName: string;
  }[],
): Promise<UserRow[]> {
  if (rows.length === 0) return [];
  const links = await tx
    .select({
      userId: userBranches.userId,
      id: branches.id,
      code: branches.code,
      name: branches.name,
    })
    .from(userBranches)
    .innerJoin(branches, eq(branches.id, userBranches.branchId))
    .where(
      inArray(
        userBranches.userId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(branches.code));
  const byUser = new Map<string, { id: string; code: string; name: string }[]>();
  for (const l of links) {
    byUser.set(l.userId, [
      ...(byUser.get(l.userId) ?? []),
      { id: l.id, code: l.code, name: l.name },
    ]);
  }
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    fullName: r.fullName,
    status: r.status,
    version: r.version,
    createdAt: r.createdAt,
    role: { id: r.roleId, key: r.roleKey, name: r.roleName },
    branches: byUser.get(r.id) ?? [],
  }));
}

/** Escapes LIKE wildcards so a search for "100%" matches literally. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listUsers(
  tx: TenantTx,
  filter: { search?: string; status?: StatusValue; limit: number; offset: number },
) {
  const where = and(
    filter.search
      ? or(
          ilike(users.email, likePattern(filter.search)),
          ilike(users.fullName, likePattern(filter.search)),
        )
      : undefined,
    filter.status ? eq(users.status, filter.status) : undefined,
  );
  const rows = await tx
    .select(userColumns)
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(where)
    .orderBy(asc(users.fullName), asc(users.id))
    .limit(filter.limit)
    .offset(filter.offset);
  const [count] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(where);
  return { items: await withBranches(tx, rows), total: count!.n };
}

export async function findUser(tx: TenantTx, id: string): Promise<UserRow | null> {
  const rows = await tx
    .select(userColumns)
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(eq(users.id, id))
    .limit(1);
  return (await withBranches(tx, rows))[0] ?? null;
}

/** Locks the user row for the rest of the transaction. */
export async function lockUser(tx: TenantTx, id: string) {
  const [row] = await tx
    .select({ id: users.id, roleId: users.roleId, status: users.status, version: users.version })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)
    .for('update');
  return row ?? null;
}

/** Locks every active Owner so two admins cannot each remove "the other" Owner. */
export async function lockActiveOwners(tx: TenantTx, ownerRoleId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.roleId, ownerRoleId), eq(users.status, 'active')))
    .for('update');
  return rows.map((r) => r.id);
}

export async function findRoleByKey(tx: TenantTx, key: string) {
  const [row] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.key, key)).limit(1);
  return row ?? null;
}

export async function insertUserRow(
  tx: TenantTx,
  values: {
    tenantId: string;
    email: string;
    passwordHash: string;
    fullName: string;
    roleId: string;
  },
) {
  const [row] = await tx.insert(users).values(values).returning({ id: users.id });
  return row!.id;
}

export async function updateUserRow(
  tx: TenantTx,
  id: string,
  version: number,
  values: { fullName: string; roleId: string; status: StatusValue },
): Promise<boolean> {
  const rows = await tx
    .update(users)
    .set({ ...values, updatedAt: sql`now()`, version: sql`${users.version} + 1` })
    .where(and(eq(users.id, id), eq(users.version, version)))
    .returning({ id: users.id });
  return rows.length === 1;
}

export async function setPasswordHash(tx: TenantTx, id: string, passwordHash: string) {
  await tx
    .update(users)
    .set({ passwordHash, updatedAt: sql`now()`, version: sql`${users.version} + 1` })
    .where(eq(users.id, id));
}

export async function replaceUserBranches(
  tx: TenantTx,
  tenantId: string,
  userId: string,
  branchIds: string[],
) {
  await tx.delete(userBranches).where(eq(userBranches.userId, userId));
  await tx
    .insert(userBranches)
    .values(branchIds.map((branchId) => ({ tenantId, userId, branchId })));
}

/** Ends every session of a user, so access stops on their next request. */
export async function revokeUserSessions(tx: TenantTx, userId: string) {
  await tx
    .update(refreshTokens)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}
