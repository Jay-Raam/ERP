import { randomBytes } from 'node:crypto';
import type { GraphQLSchema } from 'graphql';
import request from 'supertest';
import { createApp } from '../src/app';
import { loadEnv } from '../src/config/env';
import { createLogger } from '../src/core/logger';
import { createDatabase } from '../src/db/client';
import { TEST_DATABASE_URL, assertTestDatabase } from './support/test-db';

assertTestDatabase(TEST_DATABASE_URL);

/** One pool per test file. As the login role it bypasses RLS, so use it only for assertions. */
export const database = createDatabase(TEST_DATABASE_URL, { max: 5 });

export function testApp(overrides: { schema?: GraphQLSchema; env?: Record<string, string> } = {}) {
  const env = loadEnv({ NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL, ...overrides.env });
  return createApp({ env, logger: createLogger(env), database, schema: overrides.schema });
}

export type TestApp = ReturnType<typeof testApp>;

export function gql(app: TestApp, query: string, variables?: Record<string, unknown>) {
  return request(app).post('/graphql').send({ query, variables });
}

export const uniqueSlug = (prefix = 'org') => `${prefix}-${randomBytes(6).toString('hex')}`;

export const REGISTER = /* GraphQL */ `
  mutation Register($input: RegisterOrganisationInput!) {
    registerOrganisation(input: $input) {
      organisation {
        id
        slug
        name
      }
      owner {
        id
        email
        fullName
      }
    }
  }
`;

export function registerInput(overrides: Record<string, unknown> = {}) {
  return {
    organisationName: 'Acme Traders',
    organisation: uniqueSlug(),
    ownerName: 'Priya Raman',
    email: 'priya@acme.example',
    password: 'correct horse battery',
    ...overrides,
  };
}

/** Registers an organisation and returns its ids; fails the test if it did not work. */
export async function registerOrg(app: TestApp, overrides: Record<string, unknown> = {}) {
  const input = registerInput(overrides);
  const res = await gql(app, REGISTER, { input });
  if (res.body.errors) throw new Error(`register failed: ${JSON.stringify(res.body.errors)}`);
  const { organisation, owner } = res.body.data.registerOrganisation;
  return { input, tenantId: organisation.id as string, ownerId: owner.id as string };
}
