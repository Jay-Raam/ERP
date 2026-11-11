import { randomBytes } from 'node:crypto';
import type { GraphQLSchema } from 'graphql';
import request from 'supertest';
import { createApp } from '../src/app';
import { loadEnv } from '../src/config/env';
import { createLogger } from '../src/core/logger';
import { createMemoryRateLimiter, type Limits } from '../src/core/rate-limit';
import { createDatabase } from '../src/db/client';
import { TEST_DATABASE_URL, assertTestDatabase } from './support/test-db';

assertTestDatabase(TEST_DATABASE_URL);

/** One pool per test file. As the login role it bypasses RLS, so use it only for assertions. */
export const database = createDatabase(TEST_DATABASE_URL, { max: 5 });

export const TEST_JWT_SECRET = 'test-secret-test-secret-test-secret-0001';
export const CLIENT = { 'x-erp-client': 'test' };

// Suites register many organisations from one IP; the dedicated limit tests lower these.
const RELAXED: Partial<Limits> = {
  global: { limit: 100_000, windowMs: 60_000 },
  registerPerIp: { limit: 100_000, windowMs: 60_000 },
  loginPerIp: { limit: 100_000, windowMs: 60_000 },
  refreshPerIp: { limit: 100_000, windowMs: 60_000 },
};

export function testApp(
  overrides: {
    schema?: GraphQLSchema;
    env?: Record<string, string>;
    limits?: Partial<Limits>;
    refreshGraceMs?: number;
  } = {},
) {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    JWT_SECRET: TEST_JWT_SECRET,
    ...overrides.env,
  });
  return createApp({
    env,
    logger: createLogger(env),
    database,
    limiter: createMemoryRateLimiter(),
    limits: { ...RELAXED, ...overrides.limits },
    refreshGraceMs: overrides.refreshGraceMs,
    schema: overrides.schema,
  });
}

export type TestApp = ReturnType<typeof testApp>;

export function gql(app: TestApp, query: string, variables?: Record<string, unknown>) {
  return request(app).post('/graphql').set(CLIENT).send({ query, variables });
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

/** Signs in and returns an agent that keeps the session cookies. */
export async function signIn(app: TestApp, org: { input: ReturnType<typeof registerInput> }) {
  const agent = request.agent(app);
  const res = await agent.post('/auth/login').set(CLIENT).send({
    organisation: org.input.organisation,
    email: org.input.email,
    password: org.input.password,
  });
  if (res.status !== 200)
    throw new Error(`sign-in failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, res };
}

export const ME = /* GraphQL */ `
  {
    me {
      user {
        id
        email
      }
      organisation {
        id
        slug
      }
      role {
        key
        dataScope
      }
      permissions
      branches {
        code
      }
    }
  }
`;
