import { createSchema } from 'graphql-yoga';
import request from 'supertest';
import { z } from 'zod';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { loadEnv } from '../src/config/env';
import { BusinessRuleError, ForbiddenError } from '../src/core/errors';
import { createLogger } from '../src/core/logger';
import { createMemoryRateLimiter } from '../src/core/rate-limit';
import { CLIENT, database, testApp } from './helpers';

afterAll(() => database.close());

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const failingSchema = createSchema({
  typeDefs: /* GraphQL */ `
    type Query {
      forbidden: String
      rule: String
      invalid: String
      crash: String
    }
  `,
  resolvers: {
    Query: {
      forbidden: () => {
        throw new ForbiddenError();
      },
      rule: () => {
        throw new BusinessRuleError('Total does not match the server total');
      },
      invalid: () => {
        z.object({ qty: z.number().int().positive() }).parse({ qty: -1 });
      },
      crash: () => {
        throw new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2');
      },
    },
  },
});

const gql = (app: ReturnType<typeof testApp>, query: string) =>
  request(app).post('/graphql').set(CLIENT).send({ query });

describe('health', () => {
  it('GET /health/live answers ok', async () => {
    const res = await request(testApp()).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /health/ready is 200 when every dependency answers', async () => {
    const res = await request(testApp()).get('/health/ready');
    expect(res.status).toBe(200);
  });

  it('GET /health/ready is 503 and names the dependency that failed', async () => {
    const env = loadEnv({ NODE_ENV: 'test' });
    const app = createApp({
      env,
      logger: createLogger(env),
      database,
      limiter: createMemoryRateLimiter(),
      readinessChecks: [
        { name: 'postgres', check: async () => {} },
        {
          name: 'redis',
          check: async () => {
            throw new Error('down');
          },
        },
      ],
    });
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual([
      { name: 'postgres', ok: true, critical: true },
      { name: 'redis', ok: false, critical: true },
    ]);
  });

  it('query health works through GraphQL', async () => {
    const res = await gql(testApp(), '{ health { status uptimeSeconds timestamp } }');
    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.health.status).toBe('ok');
  });

  it('stays ready when only a non-critical dependency is down', async () => {
    const env = loadEnv({ NODE_ENV: 'test' });
    const app = createApp({
      env,
      logger: createLogger(env),
      database,
      limiter: createMemoryRateLimiter(),
      readinessChecks: [
        {
          name: 'redis',
          critical: false,
          check: async () => {
            throw new Error('down');
          },
        },
      ],
    });
    const res = await request(app).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.checks).toEqual([{ name: 'redis', ok: false, critical: false }]);
  });
});

describe('request id', () => {
  it('generates one and returns it in the header', async () => {
    const res = await request(testApp()).get('/health/live');
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('reuses a safe inbound id', async () => {
    const res = await request(testApp()).get('/health/live').set('x-request-id', 'abc-12345_XYZ');
    expect(res.headers['x-request-id']).toBe('abc-12345_XYZ');
  });

  it('replaces an unsafe inbound id', async () => {
    const res = await request(testApp())
      .get('/health/live')
      .set('x-request-id', '<script>alert(1)</script>');
    expect(res.headers['x-request-id']).toMatch(UUID);
  });
});

describe('central error handling: REST', () => {
  it('unknown route returns the standard error shape', async () => {
    const res = await request(testApp()).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
        requestId: res.headers['x-request-id'],
      },
    });
  });
});

describe('central error handling: GraphQL', () => {
  const app = testApp({ schema: failingSchema });

  it('AppError keeps its code and message', async () => {
    const res = await gql(app, '{ forbidden }');
    const [error] = res.body.errors;
    expect(error.message).toBe('You do not have permission to do this');
    expect(error.extensions.code).toBe('FORBIDDEN');
    expect(error.extensions.requestId).toBe(res.headers['x-request-id']);
  });

  it('business rule failures surface as BUSINESS_RULE', async () => {
    const res = await gql(app, '{ rule }');
    expect(res.body.errors[0].extensions.code).toBe('BUSINESS_RULE');
  });

  it('zod failures become VALIDATION_ERROR with field errors', async () => {
    const res = await gql(app, '{ invalid }');
    const [error] = res.body.errors;
    expect(error.extensions.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(error.extensions.fieldErrors)).toEqual(['qty']);
  });

  it('unknown errors are masked and leak nothing', async () => {
    const res = await gql(app, '{ crash }');
    const raw = JSON.stringify(res.body);
    expect(res.body.errors[0].extensions.code).toBe('INTERNAL_ERROR');
    expect(res.body.errors[0].message).toBe('Something went wrong. Please try again.');
    expect(raw).not.toContain('ECONNREFUSED');
    expect(raw).not.toContain('hunter2');
    expect(raw).not.toContain('stack');
  });

  it('errors raised by GraphQL itself get a code and request id', async () => {
    const res = await gql(app, '{ doesNotExist }');
    const [error] = res.body.errors;
    expect(error.extensions.code).toBeDefined();
    expect(error.extensions.requestId).toBe(res.headers['x-request-id']);
  });

  it('malformed query is rejected, not crashed', async () => {
    const res = await gql(app, '{ forbidden ');
    expect(res.status).toBeLessThan(500);
    expect(res.body.errors[0].extensions.code).toBeDefined();
  });
});

describe('security headers and transport', () => {
  it('hides the framework and sets hardening headers', async () => {
    const res = await request(testApp()).get('/health/live');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('allows only configured origins', async () => {
    const app = testApp({ env: { CORS_ORIGINS: 'http://localhost:3000' } });
    const ok = await request(app).get('/health/live').set('Origin', 'http://localhost:3000');
    const bad = await request(app).get('/health/live').set('Origin', 'https://evil.example');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('turns introspection off in production', async () => {
    const app = testApp({
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'silent',
        DATABASE_URL: 'postgres://u:p@db:5432/erp',
        MONGO_URL: 'mongodb://mongo:27017/erp',
        REDIS_URL: 'redis://redis:6379',
      },
    });
    const res = await gql(app, '{ __schema { types { name } } }');
    expect(res.body.data).toBeUndefined();
    expect(res.body.errors.length).toBeGreaterThan(0);
  });
});
