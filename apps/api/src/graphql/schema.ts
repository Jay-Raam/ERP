import { createSchema } from 'graphql-yoga';
import type { Env } from '../config/env';
import { authResolvers, authTypeDefs } from '../modules/auth/schema';
import { orgResolvers, orgTypeDefs } from '../modules/org/schema';
import type { Services } from '../services';
import type { GraphQLContext } from './context';

export type { GraphQLContext };

const rootTypeDefs = /* GraphQL */ `
  type Health {
    status: String!
    instance: String
    uptimeSeconds: Float!
    timestamp: String!
  }

  type Query {
    health: Health!
  }
`;

/** Root schema: each business module contributes typeDefs and resolvers. */
export function buildSchema(env: Pick<Env, 'INSTANCE_ID'>, services: Services) {
  return createSchema<GraphQLContext>({
    typeDefs: [rootTypeDefs, orgTypeDefs, authTypeDefs],
    resolvers: [
      {
        Query: {
          health: () => ({
            status: 'ok',
            instance: env.INSTANCE_ID ?? null,
            uptimeSeconds: process.uptime(),
            timestamp: new Date().toISOString(),
          }),
        },
      },
      orgResolvers(services.org),
      authResolvers,
    ],
  });
}
