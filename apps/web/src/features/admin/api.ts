'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { gqlRequest } from '@/lib/api-client';

export type DataScope = 'own' | 'branch' | 'organisation';
export type Status = 'active' | 'inactive';

export interface Role {
  id: string;
  key: string;
  name: string;
  dataScope: DataScope;
  isSystem: boolean;
  permissions: string[];
  userCount: number;
  version: number;
}
export interface Branch {
  id: string;
  code: string;
  name: string;
  isHeadOffice: boolean;
  status: Status;
  version: number;
}
export interface ManagedUser {
  id: string;
  email: string;
  fullName: string;
  status: Status;
  role: { id: string; key: string; name: string };
  branches: { id: string; code: string; name: string }[];
  createdAt: string;
  version: number;
}

const ROLE_FIELDS = 'id key name dataScope isSystem permissions userCount version';
const BRANCH_FIELDS = 'id code name isHeadOffice status version';
const USER_FIELDS =
  'id email fullName status createdAt version role { id key name } branches { id code name }';

const keys = {
  roles: ['admin', 'roles'] as const,
  branches: ['admin', 'branches'] as const,
  users: ['admin', 'users'] as const,
};

export const useRoles = () =>
  useQuery({
    queryKey: keys.roles,
    queryFn: async () =>
      (await gqlRequest<{ roles: Role[] }>(`{ roles { ${ROLE_FIELDS} } }`)).roles,
  });

export const useBranches = () =>
  useQuery({
    queryKey: keys.branches,
    queryFn: async () =>
      (await gqlRequest<{ branches: Branch[] }>(`{ branches { ${BRANCH_FIELDS} } }`)).branches,
  });

export interface UserFilter {
  search: string;
  status: Status | '';
  page: number;
}
export const USERS_PAGE_SIZE = 20;

export const useUsers = (filter: UserFilter) =>
  useQuery({
    queryKey: [...keys.users, filter],
    placeholderData: (previous) => previous,
    queryFn: async () => {
      const input = {
        search: filter.search || null,
        status: filter.status || null,
        limit: USERS_PAGE_SIZE,
        offset: filter.page * USERS_PAGE_SIZE,
      };
      const data = await gqlRequest<{ users: { items: ManagedUser[]; total: number } }>(
        `query($input: ListUsersInput){ users(input: $input){ total items { ${USER_FIELDS} } } }`,
        { input },
      );
      return data.users;
    },
  });

/** A mutation that refreshes the listed caches when it succeeds. */
function useAction<TVars, TResult>(
  run: (vars: TVars) => Promise<TResult>,
  invalidate: (readonly string[])[],
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await Promise.all(invalidate.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });
}

export interface RoleInput {
  name: string;
  dataScope: DataScope;
  permissions: string[];
}

export const useSaveRole = () =>
  useAction(
    async (vars: { id?: string; version?: number; input: RoleInput }) =>
      vars.id
        ? gqlRequest(
            `mutation($id: ID!, $input: UpdateRoleInput!){ updateRole(id:$id,input:$input){ id } }`,
            { id: vars.id, input: { ...vars.input, version: vars.version } },
          )
        : gqlRequest(`mutation($input: RoleInput!){ createRole(input:$input){ id } }`, {
            input: vars.input,
          }),
    [keys.roles as unknown as string[]],
  );

export const useDeleteRole = () =>
  useAction(
    (id: string) => gqlRequest(`mutation($id: ID!){ deleteRole(id:$id) }`, { id }),
    [keys.roles as unknown as string[]],
  );

export const useSaveBranch = () =>
  useAction(
    async (vars: {
      id?: string;
      version?: number;
      create?: { code: string; name: string };
      update?: { name: string; status: Status };
    }) =>
      vars.id
        ? gqlRequest(
            `mutation($id: ID!, $input: UpdateBranchInput!){ updateBranch(id:$id,input:$input){ id } }`,
            { id: vars.id, input: { ...vars.update, version: vars.version } },
          )
        : gqlRequest(`mutation($input: CreateBranchInput!){ createBranch(input:$input){ id } }`, {
            input: vars.create,
          }),
    [keys.branches as unknown as string[]],
  );

export interface CreateUserVars {
  fullName: string;
  email: string;
  password: string;
  roleId: string;
  branchIds: string[];
}
export interface UpdateUserVars {
  fullName: string;
  roleId: string;
  branchIds: string[];
  status: Status;
}

export const useSaveUser = () =>
  useAction(
    async (vars: {
      id?: string;
      version?: number;
      create?: CreateUserVars;
      update?: UpdateUserVars;
    }) =>
      vars.id
        ? gqlRequest(
            `mutation($id: ID!, $input: UpdateUserInput!){ updateUser(id:$id,input:$input){ id } }`,
            { id: vars.id, input: { ...vars.update, version: vars.version } },
          )
        : gqlRequest(`mutation($input: CreateUserInput!){ createUser(input:$input){ id } }`, {
            input: vars.create,
          }),
    [keys.users as unknown as string[], keys.roles as unknown as string[]],
  );

export const useResetPassword = () =>
  useAction(
    (vars: { id: string; password: string }) =>
      gqlRequest(
        `mutation($id: ID!, $password: String!){ resetUserPassword(id:$id,password:$password) }`,
        vars,
      ),
    [],
  );
