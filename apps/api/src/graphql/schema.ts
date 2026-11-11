import { createSchema } from 'graphql-yoga';
import type { Env } from '../config/env';

export interface GraphQLContext {
  requestId: string;
}

/**
 * Root schema. Each business module adds its own typeDefs and resolvers
 * from src/modules/<name>/ and is merged in here.
 */
export function buildSchema(env: Pick<Env, 'INSTANCE_ID'>) {
  return createSchema<GraphQLContext>({
    typeDefs: /* GraphQL */ `
      type Health {
        status: String!
        instance: String
        uptimeSeconds: Float!
        timestamp: String!
      }

      type Query {
        health: Health!
      }
    `,
    resolvers: {
      Query: {
        health: () => ({
          status: 'ok',
          instance: env.INSTANCE_ID ?? null,
          uptimeSeconds: process.uptime(),
          timestamp: new Date().toISOString(),
        }),
      },
    },
  });
}
