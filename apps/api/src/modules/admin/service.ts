import {
  OWNER_ROLE_KEY,
  createBranchInputSchema,
  createRoleInputSchema,
  createUserInputSchema,
  grantCovered,
  listUsersInputSchema,
  resetPasswordInputSchema,
  updateBranchInputSchema,
  updateRoleInputSchema,
  updateUserInputSchema,
  type Viewer,
} from '@erp/shared';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../core/errors';
import { parseId } from '../../core/errors/parse-id';
import { requirePermission } from '../../core/auth/guard';
import type { Logger } from '../../core/logger';
import { hashPassword } from '../../core/password';
import type { Database, TenantTx } from '../../db/client';
import { isUniqueViolation } from '../../db/errors';
import { withTenant } from '../../db/tenant';
import * as repo from './repository';

const STALE = 'Someone else changed this record. Reload it and try again.';

/** "Sale Team" -> "sale_team". The key is stable; the name can change. */
function roleKeyFromName(name: string): string {
  const key = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return key || 'role';
}

/** Nobody may hand out, or take away, permissions they do not hold themselves. */
function assertCanGrant(viewer: Viewer, permissions: readonly string[]): void {
  const missing = permissions.filter((p) => !grantCovered(viewer.permissions, p));
  if (missing.length > 0) {
    throw new ForbiddenError(
      `You cannot grant permissions you do not have yourself: ${missing.slice(0, 3).join(', ')}`,
    );
  }
}

interface AdminDeps {
  db: Database;
  logger: Logger;
}

export function createAdminService({ db, logger }: AdminDeps) {
  const run = <T>(viewer: Viewer, fn: (tx: TenantTx, tenantId: string) => Promise<T>) =>
    withTenant(db, viewer.organisation.id, (tx) => fn(tx, viewer.organisation.id));

  const audit = (viewer: Viewer, action: string, target: Record<string, unknown>) =>
    logger.info(
      { audit: true, actor: viewer.user.id, tenantId: viewer.organisation.id, action, ...target },
      'admin action',
    );

  /** The actor must hold every permission of the role they are assigning or changing. */
  async function assertRoleWithinReach(tx: TenantTx, viewer: Viewer, roleId: string) {
    assertCanGrant(viewer, await repo.permissionsOfRole(tx, roleId));
  }

  return {
    // -------------------------------------------------------------- roles
    async listRoles(viewer: Viewer) {
      requirePermission(viewer, 'rbac.role.view');
      return run(viewer, (tx) => repo.listRoles(tx));
    },

    async createRole(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'rbac.role.create');
      const input = createRoleInputSchema.parse(raw);
      assertCanGrant(viewer, input.permissions);
      try {
        const id = await run(viewer, async (tx, tenantId) => {
          const roleId = await repo.insertRole(tx, {
            tenantId,
            key: roleKeyFromName(input.name),
            name: input.name,
            dataScope: input.dataScope,
          });
          await repo.replaceRolePermissions(tx, tenantId, roleId, input.permissions);
          return roleId;
        });
        audit(viewer, 'role.create', { roleId: id });
        return (await run(viewer, (tx) => repo.listRoles(tx))).find((r) => r.id === id)!;
      } catch (error) {
        if (isUniqueViolation(error, 'roles_tenant_key_unique')) {
          throw new ConflictError('A role with this name already exists', {
            fieldErrors: { name: ['A role with this name already exists'] },
          });
        }
        throw error;
      }
    },

    async updateRole(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'rbac.role.update');
      const id = parseId(rawId);
      const input = updateRoleInputSchema.parse(raw);
      assertCanGrant(viewer, input.permissions);
      await run(viewer, async (tx, tenantId) => {
        const role = await repo.findRole(tx, id, true);
        if (!role) throw new NotFoundError('Role not found');
        if (role.isSystem) throw new BusinessRuleError('The Owner role cannot be changed');
        await assertRoleWithinReach(tx, viewer, id);
        const ok = await repo.updateRoleRow(tx, id, input.version, {
          name: input.name,
          dataScope: input.dataScope,
        });
        if (!ok) throw new ConflictError(STALE);
        await repo.replaceRolePermissions(tx, tenantId, id, input.permissions);
      });
      audit(viewer, 'role.update', { roleId: id });
      return (await run(viewer, (tx) => repo.listRoles(tx))).find((r) => r.id === id)!;
    },

    async deleteRole(viewer: Viewer, rawId: unknown) {
      requirePermission(viewer, 'rbac.role.delete');
      const id = parseId(rawId);
      await run(viewer, async (tx) => {
        const role = await repo.findRole(tx, id, true);
        if (!role) throw new NotFoundError('Role not found');
        if (role.isSystem) throw new BusinessRuleError('The Owner role cannot be deleted');
        await assertRoleWithinReach(tx, viewer, id);
        const inUse = await repo.countUsersWithRole(tx, id);
        if (inUse > 0) {
          throw new BusinessRuleError(
            `${inUse} user${inUse === 1 ? ' is' : 's are'} still on this role. Move them to another role first.`,
          );
        }
        await repo.deleteRoleRow(tx, id);
      });
      audit(viewer, 'role.delete', { roleId: id });
      return true;
    },

    // ----------------------------------------------------------- branches
    async listBranches(viewer: Viewer) {
      requirePermission(viewer, 'branch.branch.view');
      return run(viewer, (tx) => repo.listBranches(tx));
    },

    async createBranch(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'branch.branch.create');
      const input = createBranchInputSchema.parse(raw);
      try {
        const id = await run(viewer, async (tx, tenantId) => {
          const branchId = await repo.insertBranchRow(tx, { tenantId, ...input });
          return branchId;
        });
        audit(viewer, 'branch.create', { branchId: id });
        return (await run(viewer, (tx) => repo.findBranch(tx, id)))!;
      } catch (error) {
        if (isUniqueViolation(error, 'branches_tenant_code_unique')) {
          throw new ConflictError('This branch code is already used', {
            fieldErrors: { code: ['This branch code is already used'] },
          });
        }
        throw error;
      }
    },

    async updateBranch(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'branch.branch.update');
      const id = parseId(rawId);
      const input = updateBranchInputSchema.parse(raw);
      await run(viewer, async (tx) => {
        const branch = await repo.findBranch(tx, id, true);
        if (!branch) throw new NotFoundError('Branch not found');
        if (branch.isHeadOffice && input.status === 'inactive') {
          throw new BusinessRuleError('The head office cannot be deactivated');
        }
        const ok = await repo.updateBranchRow(tx, id, input.version, {
          name: input.name,
          status: input.status,
        });
        if (!ok) throw new ConflictError(STALE);
      });
      audit(viewer, 'branch.update', { branchId: id });
      return (await run(viewer, (tx) => repo.findBranch(tx, id)))!;
    },

    // -------------------------------------------------------------- users
    async listUsers(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'rbac.user.view');
      const filter = listUsersInputSchema.parse(raw ?? {});
      return run(viewer, (tx) => repo.listUsers(tx, filter));
    },

    async createUser(viewer: Viewer, raw: unknown) {
      requirePermission(viewer, 'rbac.user.create');
      const input = createUserInputSchema.parse(raw);
      const passwordHash = await hashPassword(input.password);
      try {
        const id = await run(viewer, async (tx, tenantId) => {
          const role = await repo.findRole(tx, input.roleId);
          if (!role) throw new ValidationError({ roleId: ['Choose a valid role'] });
          await assertRoleWithinReach(tx, viewer, role.id);
          if ((await repo.countActiveBranches(tx, input.branchIds)) !== input.branchIds.length) {
            throw new ValidationError({ branchIds: ['Choose active branches only'] });
          }
          const userId = await repo.insertUserRow(tx, {
            tenantId,
            email: input.email,
            passwordHash,
            fullName: input.fullName,
            roleId: role.id,
          });
          await repo.replaceUserBranches(tx, tenantId, userId, input.branchIds);
          return userId;
        });
        audit(viewer, 'user.create', { userId: id });
        return (await run(viewer, (tx) => repo.findUser(tx, id)))!;
      } catch (error) {
        if (
          isUniqueViolation(error, 'users_email_unique') ||
          isUniqueViolation(error, 'users_tenant_email_unique')
        ) {
          throw new ConflictError('A user with this email already exists', {
            fieldErrors: { email: ['A user with this email already exists'] },
          });
        }
        throw error;
      }
    },

    async updateUser(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'rbac.user.update');
      const id = parseId(rawId);
      const input = updateUserInputSchema.parse(raw);
      await run(viewer, async (tx, tenantId) => {
        const target = await repo.lockUser(tx, id);
        if (!target) throw new NotFoundError('User not found');
        if (target.version !== input.version) throw new ConflictError(STALE);

        const isSelf = target.id === viewer.user.id;
        if (isSelf && (input.status !== 'active' || input.roleId !== target.roleId)) {
          throw new BusinessRuleError('You cannot change your own role or deactivate yourself');
        }

        const newRole = await repo.findRole(tx, input.roleId);
        if (!newRole) throw new ValidationError({ roleId: ['Choose a valid role'] });
        // Both the role they have now and the one they are getting must be within reach.
        await assertRoleWithinReach(tx, viewer, target.roleId);
        await assertRoleWithinReach(tx, viewer, newRole.id);

        const currentRole = await repo.findRole(tx, target.roleId);
        const losingOwner =
          currentRole?.key === OWNER_ROLE_KEY &&
          target.status === 'active' &&
          (newRole.id !== target.roleId || input.status !== 'active');
        if (losingOwner) {
          const owners = await repo.lockActiveOwners(tx, target.roleId);
          if (owners.length <= 1) {
            throw new BusinessRuleError('An organisation must keep at least one active Owner');
          }
        }

        if ((await repo.countActiveBranches(tx, input.branchIds)) !== input.branchIds.length) {
          throw new ValidationError({ branchIds: ['Choose active branches only'] });
        }

        const ok = await repo.updateUserRow(tx, id, input.version, {
          fullName: input.fullName,
          roleId: input.roleId,
          status: input.status,
        });
        if (!ok) throw new ConflictError(STALE);
        await repo.replaceUserBranches(tx, tenantId, id, input.branchIds);
        if (input.status === 'inactive') await repo.revokeUserSessions(tx, id);
      });
      audit(viewer, 'user.update', { userId: id });
      return (await run(viewer, (tx) => repo.findUser(tx, id)))!;
    },

    async resetUserPassword(viewer: Viewer, rawId: unknown, raw: unknown) {
      requirePermission(viewer, 'rbac.user.update');
      const id = parseId(rawId);
      const { password } = resetPasswordInputSchema.parse(raw);
      if (id === viewer.user.id) {
        throw new BusinessRuleError('You cannot reset your own password this way');
      }
      const passwordHash = await hashPassword(password);
      await run(viewer, async (tx) => {
        const target = await repo.lockUser(tx, id);
        if (!target) throw new NotFoundError('User not found');
        await assertRoleWithinReach(tx, viewer, target.roleId);
        await repo.setPasswordHash(tx, id, passwordHash);
        await repo.revokeUserSessions(tx, id);
      });
      audit(viewer, 'user.reset-password', { userId: id });
      return true;
    },
  };
}

export type AdminService = ReturnType<typeof createAdminService>;
