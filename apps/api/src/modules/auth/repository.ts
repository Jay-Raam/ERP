import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Viewer } from '@erp/shared';
import type { TenantTx } from '../../db/client';
import {
  branches,
  organisations,
  refreshTokens,
  rolePermissions,
  roles,
  userBranches,
  users,
} from '../../db/schema';

export async function findUserForLogin(tx: TenantTx, email: string) {
  const [row] = await tx
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      status: users.status,
      orgStatus: organisations.status,
    })
    .from(users)
    .innerJoin(organisations, eq(organisations.id, users.tenantId))
    .where(eq(users.email, email))
    .limit(1);
  return row ?? null;
}

export async function isUserActive(tx: TenantTx, userId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(organisations, eq(organisations.id, users.tenantId))
    .where(
      and(eq(users.id, userId), eq(users.status, 'active'), eq(organisations.status, 'active')),
    )
    .limit(1);
  return row !== undefined;
}

export async function insertRefreshToken(
  tx: TenantTx,
  values: {
    tenantId: string;
    userId: string;
    familyId: string;
    tokenHash: string;
    expiresAt: Date;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<void> {
  await tx.insert(refreshTokens).values(values);
}

/**
 * Marks a token as spent and returns it, in one statement. Two requests
 * presenting the same token cannot both get a row back.
 */
export async function claimRefreshToken(tx: TenantTx, tokenHash: string) {
  const [row] = await tx
    .update(refreshTokens)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(refreshTokens.tokenHash, tokenHash),
        isNull(refreshTokens.usedAt),
        isNull(refreshTokens.revokedAt),
        gt(refreshTokens.expiresAt, sql`now()`),
      ),
    )
    .returning({ userId: refreshTokens.userId, familyId: refreshTokens.familyId });
  return row ?? null;
}

export async function findRefreshToken(tx: TenantTx, tokenHash: string) {
  const [row] = await tx
    .select({
      familyId: refreshTokens.familyId,
      revokedAt: refreshTokens.revokedAt,
      /** Milliseconds since the token was spent; null if it never was. */
      usedAgoMs: sql<
        number | null
      >`(extract(epoch from (now() - ${refreshTokens.usedAt})) * 1000)::float8`,
    })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);
  return row ?? null;
}

export async function revokeFamily(tx: TenantTx, familyId: string): Promise<void> {
  await tx
    .update(refreshTokens)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
}

/**
 * Loads the signed-in user with role, permissions and branches.
 * Returns null unless the user and organisation are active and the session
 * (refresh-token family) is still alive, so sign-out and deactivation take
 * effect on the next request, not when the access token expires.
 */
export async function loadViewer(
  tx: TenantTx,
  userId: string,
  sessionId: string,
): Promise<Viewer | null> {
  const [row] = await tx
    .select({
      userId: users.id,
      email: users.email,
      fullName: users.fullName,
      roleId: roles.id,
      roleKey: roles.key,
      roleName: roles.name,
      dataScope: roles.dataScope,
      orgId: organisations.id,
      orgSlug: organisations.slug,
      orgName: organisations.name,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .innerJoin(organisations, eq(organisations.id, users.tenantId))
    .where(
      and(
        eq(users.id, userId),
        eq(users.status, 'active'),
        eq(organisations.status, 'active'),
        sql`exists (
          select 1 from ${refreshTokens}
          where ${refreshTokens.familyId} = ${sessionId}
            and ${refreshTokens.userId} = ${users.id}
            and ${refreshTokens.revokedAt} is null
            and ${refreshTokens.expiresAt} > now()
        )`,
      ),
    )
    .limit(1);
  if (!row) return null;

  const [permissionRows, branchRows] = [
    await tx
      .select({ key: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, row.roleId)),
    await tx
      .select({
        id: branches.id,
        code: branches.code,
        name: branches.name,
        isHeadOffice: branches.isHeadOffice,
      })
      .from(userBranches)
      .innerJoin(branches, eq(branches.id, userBranches.branchId))
      .where(and(eq(userBranches.userId, userId), eq(branches.status, 'active')))
      .orderBy(branches.code),
  ];

  return {
    user: { id: row.userId, email: row.email, fullName: row.fullName },
    organisation: { id: row.orgId, slug: row.orgSlug, name: row.orgName },
    role: { key: row.roleKey, name: row.roleName, dataScope: row.dataScope },
    permissions: permissionRows.map((p) => p.key).sort(),
    branches: branchRows,
  };
}
