import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { DEMO_ORG, DEMO_PASSWORD, DEMO_USERS, seedDemo } from '../src/db/seed';
import { CLIENT, database, testApp } from './helpers';
import { TEST_DATABASE_URL } from './support/test-db';

const app = testApp();
afterAll(() => database.close());

describe('demo seed', () => {
  it('creates the demo organisation once and every demo user can sign in', async () => {
    const first = await seedDemo(TEST_DATABASE_URL);
    expect(['created', 'exists']).toContain(first);
    expect(await seedDemo(TEST_DATABASE_URL)).toBe('exists');

    for (const u of DEMO_USERS) {
      const res = await request(app)
        .post('/auth/login')
        .set(CLIENT)
        .send({ organisation: DEMO_ORG, email: u.email, password: DEMO_PASSWORD });
      expect(res.status, u.email).toBe(200);
      expect(res.body.viewer.role.key).toBe(u.role);
    }
  });
});
