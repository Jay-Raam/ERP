import type { GraphQLContext } from '../../graphql/context';

export const authTypeDefs = /* GraphQL */ `
  enum DataScope {
    own
    branch
    organisation
  }

  type RoleSummary {
    key: String!
    name: String!
    dataScope: DataScope!
  }

  type BranchSummary {
    id: ID!
    code: String!
    name: String!
    isHeadOffice: Boolean!
  }

  type Viewer {
    user: UserSummary!
    organisation: Organisation!
    role: RoleSummary!
    "Permission grants. Segments may be * wildcards."
    permissions: [String!]!
    "Branches this user may work in."
    branches: [BranchSummary!]!
  }

  type Query {
    "The signed-in user. Fails with UNAUTHENTICATED when there is no valid session."
    me: Viewer!
  }
`;

export const authResolvers = {
  Query: {
    me: (_parent: unknown, _args: unknown, ctx: GraphQLContext) => ctx.viewer(),
  },
};
