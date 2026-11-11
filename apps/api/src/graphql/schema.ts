import { createSchema } from 'graphql-yoga';
import type { Env } from '../config/env';
import type { Logger } from '../core/logger';
import type { Database } from '../db/client';
import { orgResolvers, orgTypeDefs } from '../modules/org/schema';
import { createOrgService } from '../modules/org/service';
import type { GraphQLContext } from './context';

export type { GraphQLContext };

export interface SchemaDeps {
  env: Pick<Env, 'INSTANCE_ID'>;
  db: Database;
  logger: Logger;
}

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
export function buildSchema({ env, db, logger }: SchemaDeps) {
  const orgService = createOrgService({ db, logger });

  return createSchema<GraphQLContext>({
    typeDefs: [rootTypeDefs, orgTypeDefs],
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
      orgResolvers(orgService),
    ],
  });
}
