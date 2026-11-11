import { PERMISSION_CATALOGUE } from '@erp/shared';
import type { GraphQLContext } from '../../graphql/context';
import type { AdminService } from './service';

export const adminTypeDefs = /* GraphQL */ `
  enum RecordStatus {
    active
    inactive
  }

  type PermissionDef {
    key: String!
    module: String!
    label: String!
  }

  type Role {
    id: ID!
    key: String!
    name: String!
    dataScope: DataScope!
    "System roles (Owner) cannot be edited or deleted."
    isSystem: Boolean!
    permissions: [String!]!
    userCount: Int!
    "Send this back when saving; a mismatch means someone else edited the role."
    version: Int!
  }

  type Branch {
    id: ID!
    code: String!
    name: String!
    isHeadOffice: Boolean!
    status: RecordStatus!
    version: Int!
  }

  type UserBranch {
    id: ID!
    code: String!
    name: String!
  }

  type UserRole {
    id: ID!
    key: String!
    name: String!
  }

  type ManagedUser {
    id: ID!
    email: String!
    fullName: String!
    status: RecordStatus!
    role: UserRole!
    branches: [UserBranch!]!
    createdAt: String!
    version: Int!
  }

  type UserPage {
    items: [ManagedUser!]!
    total: Int!
  }

  input RoleInput {
    name: String!
    dataScope: DataScope!
    permissions: [String!]!
  }

  input UpdateRoleInput {
    name: String!
    dataScope: DataScope!
    permissions: [String!]!
    version: Int!
  }

  input CreateBranchInput {
    code: String!
    name: String!
  }

  input UpdateBranchInput {
    name: String!
    status: RecordStatus!
    version: Int!
  }

  input CreateUserInput {
    fullName: String!
    email: String!
    password: String!
    roleId: ID!
    branchIds: [ID!]!
  }

  input UpdateUserInput {
    fullName: String!
    roleId: ID!
    branchIds: [ID!]!
    status: RecordStatus!
    version: Int!
  }

  input ListUsersInput {
    search: String
    status: RecordStatus
    limit: Int
    offset: Int
  }

  extend type Query {
    "Every permission the role editor can offer."
    permissionCatalogue: [PermissionDef!]!
    roles: [Role!]!
    branches: [Branch!]!
    users(input: ListUsersInput): UserPage!
  }

  extend type Mutation {
    createRole(input: RoleInput!): Role!
    updateRole(id: ID!, input: UpdateRoleInput!): Role!
    deleteRole(id: ID!): Boolean!
    createBranch(input: CreateBranchInput!): Branch!
    updateBranch(id: ID!, input: UpdateBranchInput!): Branch!
    createUser(input: CreateUserInput!): ManagedUser!
    updateUser(id: ID!, input: UpdateUserInput!): ManagedUser!
    "Sets a new password and signs the user out everywhere."
    resetUserPassword(id: ID!, password: String!): Boolean!
  }
`;

type Args<T> = { input: T };
type IdArgs<T> = { id: string; input: T };

const iso = <U extends { createdAt: Date }>(u: U) => ({
  ...u,
  createdAt: u.createdAt.toISOString(),
});

export function adminResolvers(service: AdminService) {
  return {
    Query: {
      permissionCatalogue: async (_p: unknown, _a: unknown, ctx: GraphQLContext) => {
        const viewer = await ctx.viewer();
        await service.listRoles(viewer); // same permission as the role screen
        return PERMISSION_CATALOGUE;
      },
      roles: async (_p: unknown, _a: unknown, ctx: GraphQLContext) =>
        service.listRoles(await ctx.viewer()),
      branches: async (_p: unknown, _a: unknown, ctx: GraphQLContext) =>
        service.listBranches(await ctx.viewer()),
      users: async (_p: unknown, args: { input?: unknown }, ctx: GraphQLContext) => {
        const page = await service.listUsers(await ctx.viewer(), args.input);
        return { total: page.total, items: page.items.map(iso) };
      },
    },
    Mutation: {
      createRole: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        service.createRole(await ctx.viewer(), a.input),
      updateRole: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        service.updateRole(await ctx.viewer(), a.id, a.input),
      deleteRole: async (_p: unknown, a: { id: string }, ctx: GraphQLContext) =>
        service.deleteRole(await ctx.viewer(), a.id),
      createBranch: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        service.createBranch(await ctx.viewer(), a.input),
      updateBranch: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        service.updateBranch(await ctx.viewer(), a.id, a.input),
      createUser: async (_p: unknown, a: Args<unknown>, ctx: GraphQLContext) =>
        iso(await service.createUser(await ctx.viewer(), a.input)),
      updateUser: async (_p: unknown, a: IdArgs<unknown>, ctx: GraphQLContext) =>
        iso(await service.updateUser(await ctx.viewer(), a.id, a.input)),
      resetUserPassword: async (
        _p: unknown,
        a: { id: string; password: string },
        ctx: GraphQLContext,
      ) => service.resetUserPassword(await ctx.viewer(), a.id, { password: a.password }),
    },
  };
}
