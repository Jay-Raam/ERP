import type { RoleSeed } from '@erp/shared';
import type { TenantTx } from '../../db/client';
import {
  branches,
  organisations,
  rolePermissions,
  roles,
  userBranches,
  users,
} from '../../db/schema';

export async function insertOrganisation(
  tx: TenantTx,
  values: { id: string; slug: string; name: string },
) {
  const [row] = await tx
    .insert(organisations)
    .values(values)
    .returning({ id: organisations.id, slug: organisations.slug, name: organisations.name });
  return row!;
}

/** Inserts the seed roles with their permissions; returns role id by key. */
export async function insertRoles(tx: TenantTx, tenantId: string, seeds: readonly RoleSeed[]) {
  const inserted = await tx
    .insert(roles)
    .values(
      seeds.map((seed) => ({
        tenantId,
        key: seed.key,
        name: seed.name,
        dataScope: seed.dataScope,
        isSystem: seed.key === 'owner',
      })),
    )
    .returning({ id: roles.id, key: roles.key });

  const idByKey = new Map(inserted.map((role) => [role.key, role.id]));
  await tx.insert(rolePermissions).values(
    seeds.flatMap((seed) =>
      seed.permissions.map((permissionKey) => ({
        tenantId,
        roleId: idByKey.get(seed.key)!,
        permissionKey,
      })),
    ),
  );
  return idByKey;
}

export async function insertBranch(
  tx: TenantTx,
  values: { tenantId: string; code: string; name: string; isHeadOffice: boolean },
) {
  const [row] = await tx.insert(branches).values(values).returning({ id: branches.id });
  return row!;
}

export async function insertUser(
  tx: TenantTx,
  values: {
    tenantId: string;
    email: string;
    passwordHash: string;
    fullName: string;
    roleId: string;
  },
) {
  const [row] = await tx
    .insert(users)
    .values(values)
    .returning({ id: users.id, email: users.email, fullName: users.fullName });
  return row!;
}

export async function assignBranch(
  tx: TenantTx,
  values: { tenantId: string; userId: string; branchId: string },
) {
  await tx.insert(userBranches).values(values);
}
