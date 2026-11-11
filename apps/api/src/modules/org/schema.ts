import type { GraphQLContext } from '../../graphql/context';
import type { OrgService } from './service';

export const orgTypeDefs = /* GraphQL */ `
  type Organisation {
    id: ID!
    "What users type in the organisation box when signing in."
    slug: String!
    name: String!
  }

  type UserSummary {
    id: ID!
    email: String!
    fullName: String!
  }

  input RegisterOrganisationInput {
    organisationName: String!
    "Organisation ID: lower-case letters, numbers and hyphens."
    organisation: String!
    ownerName: String!
    email: String!
    password: String!
  }

  type RegisterOrganisationPayload {
    organisation: Organisation!
    owner: UserSummary!
  }

  type Mutation {
    "Creates a new organisation. The first user becomes its Owner."
    registerOrganisation(input: RegisterOrganisationInput!): RegisterOrganisationPayload!
  }
`;

// Resolvers stay thin: hand the raw input to the service and return its result.
export function orgResolvers(service: OrgService) {
  return {
    Mutation: {
      registerOrganisation: (_parent: unknown, args: { input: unknown }, ctx: GraphQLContext) =>
        service.register(args.input, { ip: ctx.ip }),
    },
  };
}
