import { z } from 'zod';
import { emailSchema } from './auth';
import { passwordSchema } from './org';
import { plainText } from './text';
import { isPermissionGrant } from '../permissions';

const uuid = z.uuid('Invalid id');

export const dataScopeSchema = z.enum(['own', 'branch', 'organisation']);

const permissionList = z
  .array(z.string().trim().refine(isPermissionGrant, { message: 'Unknown permission format' }))
  .max(200, 'Too many permissions')
  .transform((list) => [...new Set(list)].sort());

export const createRoleInputSchema = z.strictObject({
  name: plainText('Role name', 2, 60),
  dataScope: dataScopeSchema,
  permissions: permissionList,
});
export type CreateRoleInput = z.infer<typeof createRoleInputSchema>;

export const updateRoleInputSchema = z.strictObject({
  name: plainText('Role name', 2, 60),
  dataScope: dataScopeSchema,
  permissions: permissionList,
  version: z.number().int().min(1),
});
export type UpdateRoleInput = z.infer<typeof updateRoleInputSchema>;

export const recordStatusSchema = z.enum(['active', 'inactive']);

export const createBranchInputSchema = z.strictObject({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'Code must be at least 2 characters')
    .max(12, 'Code must be at most 12 characters')
    .regex(/^[A-Z0-9][A-Z0-9-]*$/, 'Use letters, numbers and hyphens only'),
  name: plainText('Branch name', 2, 80),
});
export type CreateBranchInput = z.infer<typeof createBranchInputSchema>;

export const updateBranchInputSchema = z.strictObject({
  name: plainText('Branch name', 2, 80),
  status: recordStatusSchema,
  version: z.number().int().min(1),
});
export type UpdateBranchInput = z.infer<typeof updateBranchInputSchema>;

const branchIds = z
  .array(uuid)
  .min(1, 'Choose at least one branch')
  .max(100)
  .transform((ids) => [...new Set(ids)]);

export const createUserInputSchema = z.strictObject({
  fullName: plainText('Full name', 2, 120),
  email: emailSchema,
  password: passwordSchema,
  roleId: uuid,
  branchIds,
});
export type CreateUserInput = z.infer<typeof createUserInputSchema>;

export const updateUserInputSchema = z.strictObject({
  fullName: plainText('Full name', 2, 120),
  roleId: uuid,
  branchIds,
  status: recordStatusSchema,
  version: z.number().int().min(1),
});
export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;

export const resetPasswordInputSchema = z.strictObject({ password: passwordSchema });

/** GraphQL sends `null` for an omitted optional variable, so null means "not set". */
export const listUsersInputSchema = z.strictObject({
  search: z
    .string()
    .trim()
    .max(100)
    .nullish()
    .transform((v) => (v ? v : undefined)),
  status: recordStatusSchema.nullish().transform((v) => v ?? undefined),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .nullish()
    .transform((v) => v ?? 25),
  offset: z
    .number()
    .int()
    .min(0)
    .max(100_000)
    .nullish()
    .transform((v) => v ?? 0),
});

export const idSchema = uuid;
