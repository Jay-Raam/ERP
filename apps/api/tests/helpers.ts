import type { GraphQLSchema } from 'graphql';
import { createApp } from '../src/app';
import { loadEnv } from '../src/config/env';
import { createLogger } from '../src/core/logger';

export function testApp(overrides: { schema?: GraphQLSchema; env?: Record<string, string> } = {}) {
  const env = loadEnv({ NODE_ENV: 'test', ...overrides.env });
  return createApp({ env, logger: createLogger(env), schema: overrides.schema });
}
