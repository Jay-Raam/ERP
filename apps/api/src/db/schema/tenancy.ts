import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { id, timestamps, version } from './columns';

export const recordStatus = pgEnum('record_status', ['active', 'inactive']);
export const dataScope = pgEnum('data_scope', ['own', 'branch', 'organisation']);

/** The tenant. Every other table carries its id as tenant_id. */
export const organisations = pgTable(
  'organisations',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    status: recordStatus('status').notNull().default('active'),
    ...timestamps,
    version: version(),
  },
  (t) => [
    unique('organisations_slug_unique').on(t.slug),
    check('organisations_slug_format', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => organisations.id, { onDelete: 'restrict' });

export const roles = pgTable(
  'roles',
  {
    id: id(),
    tenantId: tenantId(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    dataScope: dataScope('data_scope').notNull(),
    /** System roles (owner) cannot be edited or deleted. */
    isSystem: boolean('is_system').notNull().default(false),
    ...timestamps,
    version: version(),
  },
  (t) => [
    unique('roles_tenant_key_unique').on(t.tenantId, t.key),
    // Target for composite foreign keys, so a row can never point at another tenant's role.
    unique('roles_tenant_id_unique').on(t.tenantId, t.id),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    tenantId: tenantId(),
    roleId: uuid('role_id').notNull(),
    permissionKey: text('permission_key').notNull(),
  },
  (t) => [
    primaryKey({ name: 'role_permissions_pk', columns: [t.roleId, t.permissionKey] }),
    foreignKey({
      name: 'role_permissions_role_fk',
      columns: [t.tenantId, t.roleId],
      foreignColumns: [roles.tenantId, roles.id],
    }).onDelete('cascade'),
    index('role_permissions_tenant_idx').on(t.tenantId),
  ],
);

export const branches = pgTable(
  'branches',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isHeadOffice: boolean('is_head_office').notNull().default(false),
    status: recordStatus('status').notNull().default('active'),
    ...timestamps,
    version: version(),
  },
  (t) => [
    unique('branches_tenant_code_unique').on(t.tenantId, t.code),
    unique('branches_tenant_id_unique').on(t.tenantId, t.id),
  ],
);

export const users = pgTable(
  'users',
  {
    id: id(),
    tenantId: tenantId(),
    /** Always stored lower-case; unique within one organisation. */
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    /** One role per organisation. */
    roleId: uuid('role_id').notNull(),
    status: recordStatus('status').notNull().default('active'),
    ...timestamps,
    version: version(),
  },
  (t) => [
    unique('users_tenant_email_unique').on(t.tenantId, t.email),
    unique('users_tenant_id_unique').on(t.tenantId, t.id),
    check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
    foreignKey({
      name: 'users_role_fk',
      columns: [t.tenantId, t.roleId],
      foreignColumns: [roles.tenantId, roles.id],
    }).onDelete('restrict'),
    index('users_tenant_role_idx').on(t.tenantId, t.roleId),
  ],
);

/** Branches a user may work in. */
export const userBranches = pgTable(
  'user_branches',
  {
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    branchId: uuid('branch_id').notNull(),
  },
  (t) => [
    primaryKey({ name: 'user_branches_pk', columns: [t.userId, t.branchId] }),
    foreignKey({
      name: 'user_branches_user_fk',
      columns: [t.tenantId, t.userId],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'user_branches_branch_fk',
      columns: [t.tenantId, t.branchId],
      foreignColumns: [branches.tenantId, branches.id],
    }).onDelete('cascade'),
    index('user_branches_tenant_branch_idx').on(t.tenantId, t.branchId),
  ],
);

/**
 * One row per issued refresh token. Only the SHA-256 of the token is stored.
 * Tokens issued from one login share a family; reuse of a spent token revokes
 * the whole family.
 */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id').notNull(),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    unique('refresh_tokens_hash_unique').on(t.tokenHash),
    foreignKey({
      name: 'refresh_tokens_user_fk',
      columns: [t.tenantId, t.userId],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete('cascade'),
    index('refresh_tokens_family_idx').on(t.tenantId, t.familyId),
    index('refresh_tokens_user_idx').on(t.tenantId, t.userId),
  ],
);
