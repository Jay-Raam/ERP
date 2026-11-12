import { createSchema } from 'graphql-yoga';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { CLIENT, gql, testApp } from './helpers';

const app = testApp();

describe('GraphQL query limits', () => {
  it('refuses a flood of aliases before any resolver runs', async () => {
    const aliases = Array.from({ length: 3000 }, (_, i) => `a${i}: health { status }`).join(' ');
    const res = await gql(app, `{ ${aliases} }`);
    expect(res.status).toBe(400);
    expect(res.body.errors[0].message).toMatch(/too many things at once|too large/);
  });

  it('refuses too many root fields even when the total is small', async () => {
    const aliases = Array.from({ length: 11 }, (_, i) => `a${i}: health { status }`).join(' ');
    const res = await gql(app, `{ ${aliases} }`);
    expect(res.body.errors[0].message).toMatch(/too many things at once/);
  });

  it('refuses very deep queries', async () => {
    const nested = testApp({
      schema: createSchema({
        typeDefs: 'type Node { id: ID child: Node } type Query { node: Node }',
        resolvers: { Query: { node: () => ({ id: '1' }) } },
      }),
    });
    const deep = (levels: number) =>
      `{ node ${'{ child '.repeat(levels)}{ id }${' }'.repeat(levels)} }`;
    const tooDeep = await gql(nested, deep(12));
    expect(tooDeep.status).toBe(400);
    expect(tooDeep.body.errors[0].message).toMatch(/too deep/);
    expect((await gql(nested, deep(5))).status).toBe(200);
  });

  it('does not multiply cost through fragments that spread each other', async () => {
    const fragments = Array.from(
      { length: 30 },
      (_, i) =>
        `fragment F${i} on Query { health { status } ${i < 29 ? `...F${i + 1} ...F${i + 1}` : ''} }`,
    ).join(' ');
    const started = Date.now();
    const res = await gql(app, `{ ...F0 } ${fragments}`);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(res.body.errors[0].message).toMatch(/too large|too many/);
  });

  it('still allows normal queries and introspection', async () => {
    const ok = await gql(app, '{ health { status } }');
    expect(ok.status).toBe(200);
    expect(ok.body.data.health.status).toBe('ok');
    const intro = await gql(
      app,
      '{ __schema { types { name fields { name type { name ofType { name ofType { name ofType { name } } } } } } } }',
    );
    expect(intro.status).toBe(200);
  });
});

describe('GraphQL request size', () => {
  it('refuses a body over the limit with 413, like the REST endpoints', async () => {
    const padding = 'x'.repeat(400 * 1024);
    const res = await request(app)
      .post('/graphql')
      .set(CLIENT)
      .send({ query: '{ health { status } }', variables: { padding } });
    expect(res.status).toBe(413);
  });

  it('accepts a normal body', async () => {
    const res = await gql(app, '{ health { status } }');
    expect(res.status).toBe(200);
  });
});
