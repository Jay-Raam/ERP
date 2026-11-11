import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTokenService } from '../src/core/auth/tokens';
import { organisations, refreshTokens, users } from '../src/db/schema';
import {
  CLIENT,
  ME,
  TEST_JWT_SECRET,
  database,
  gql,
  registerOrg,
  signIn,
  testApp,
  type TestApp,
} from './helpers';

const app = testApp();
const { db } = database;
const tokens = createTokenService(TEST_JWT_SECRET);

type Org = Awaited<ReturnType<typeof registerOrg>>;
let a: Org;
let b: Org;

beforeAll(async () => {
  a = await registerOrg(app, { email: 'owner@a.example' });
  b = await registerOrg(app, { email: 'owner@b.example' });
});

afterAll(() => database.close());

const cookiesOf = (res: request.Response): string[] => [res.headers['set-cookie'] ?? []].flat();
const cookie = (res: request.Response, name: string) =>
  cookiesOf(res).find((c) => c.startsWith(`${name}=`));
const cookieValue = (res: request.Response, name: string) =>
  cookie(res, name)
    ?.split(';')[0]!
    .slice(name.length + 1);

const login = (target: TestApp, body: Record<string, unknown>) =>
  request(target).post('/auth/login').set(CLIENT).send(body);
const credentials = (org: Org, overrides: Record<string, unknown> = {}) => ({
  organisation: org.input.organisation,
  email: org.input.email,
  password: org.input.password,
  ...overrides,
});
const me = (accessToken: string) =>
  request(app)
    .post('/graphql')
    .set(CLIENT)
    .set('Cookie', `erp_at=${accessToken}`)
    .send({ query: ME });

describe('POST /auth/login', () => {
  it('signs in and returns the viewer with permissions', async () => {
    const res = await login(app, credentials(a));
    expect(res.status).toBe(200);
    expect(res.body.viewer).toMatchObject({
      user: { id: a.ownerId, email: 'owner@a.example' },
      organisation: { id: a.tenantId, slug: a.input.organisation },
      role: { key: 'owner', dataScope: 'organisation' },
      permissions: ['*'],
      branches: [{ code: 'HO', isHeadOffice: true }],
    });
  });

  it('sets httpOnly, SameSite cookies and keeps tokens out of the body', async () => {
    const res = await login(app, credentials(a));
    for (const name of ['erp_at', 'erp_rt', 'erp_session']) {
      expect(cookie(res, name), name).toMatch(/HttpOnly/);
      expect(cookie(res, name), name).toMatch(/SameSite=Lax/);
    }
    expect(cookie(res, 'erp_at')).toMatch(/Path=\/;/);
    expect(cookie(res, 'erp_rt')).toMatch(/Path=\/auth;/);
    expect(res.headers['cache-control']).toBe('no-store');

    const body = JSON.stringify(res.body);
    expect(body).not.toContain(cookieValue(res, 'erp_at')!);
    expect(body).not.toContain(cookieValue(res, 'erp_rt')!.split('.')[1]!);
    expect(body).not.toMatch(/argon2|passwordHash/);
  });

  it('marks cookies Secure in production', async () => {
    const prod = testApp({
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'silent',
        MONGO_URL: 'mongodb://mongo:27017/erp',
        REDIS_URL: 'redis://redis:6379',
      },
    });
    const res = await login(prod, credentials(a));
    expect(res.status).toBe(200);
    for (const name of ['erp_at', 'erp_rt', 'erp_session'])
      expect(cookie(res, name)).toMatch(/Secure/);
  });

  it('stores only a hash of the refresh token', async () => {
    const res = await login(app, credentials(a));
    const raw = cookieValue(res, 'erp_rt')!;
    const rows = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tenantId, a.tenantId));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => /^[0-9a-f]{64}$/.test(r.tokenHash))).toBe(true);
    expect(rows.some((r) => raw.includes(r.tokenHash) || r.tokenHash.includes(raw))).toBe(false);
  });

  it('accepts the organisation and email in any case', async () => {
    const res = await login(
      app,
      credentials(a, {
        organisation: a.input.organisation.toUpperCase(),
        email: ' OWNER@A.Example ',
      }),
    );
    expect(res.status).toBe(200);
  });

  it.each([
    ['wrong password', (o: Org) => credentials(o, { password: 'not the password' })],
    ['unknown email', (o: Org) => credentials(o, { email: 'nobody@a.example' })],
    ['unknown organisation', (o: Org) => credentials(o, { organisation: 'no-such-org-zzz' })],
    ['another tenant’s user', (o: Org) => credentials(o, { email: 'owner@b.example' })],
  ])('gives the same answer for %s', async (_label, build) => {
    const res = await login(app, build(a));
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Organisation, email or password is incorrect',
    });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('validates input and reports fields', async () => {
    const res = await login(app, { organisation: '', email: 'nope', password: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(res.body.error.fieldErrors).sort()).toEqual([
      'email',
      'organisation',
      'password',
    ]);
  });

  it.each([
    [{ organisation: "x' OR '1'='1", email: "a@b.co' OR 1=1 --", password: "' OR ''='" }],
    [{ organisation: { $ne: null }, email: { $gt: '' }, password: { $ne: '' } }],
    [{ organisation: ['a'], email: ['b'], password: ['c'] }],
    [
      {
        ...credentials({ input: { organisation: 'x', email: 'a@b.co', password: 'x' } } as Org),
        role: 'owner',
      },
    ],
  ])('rejects injection-shaped input %#', async (body) => {
    const res = await login(app, body as Record<string, unknown>);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects malformed and oversized JSON without a 500', async () => {
    const bad = await request(app)
      .post('/auth/login')
      .set(CLIENT)
      .set('Content-Type', 'application/json')
      .send('{"organisation": ');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('BAD_REQUEST');

    const big = await login(app, credentials(a, { password: 'x'.repeat(20_000) }));
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('BAD_REQUEST');
  });

  it('refuses an inactive user and an inactive organisation', async () => {
    const org = await registerOrg(app);
    await db.update(users).set({ status: 'inactive' }).where(eq(users.id, org.ownerId));
    expect((await login(app, credentials(org))).status).toBe(401);

    await db.update(users).set({ status: 'active' }).where(eq(users.id, org.ownerId));
    await db
      .update(organisations)
      .set({ status: 'inactive' })
      .where(eq(organisations.id, org.tenantId));
    expect((await login(app, credentials(org))).status).toBe(401);
  });
});

describe('CSRF guard', () => {
  it('blocks writes without the client header', async () => {
    const res = await request(app).post('/auth/login').send(credentials(a));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('blocks writes from an origin we do not serve', async () => {
    const res = await request(app)
      .post('/auth/login')
      .set(CLIENT)
      .set('Origin', 'https://evil.example')
      .send(credentials(a));
    expect(res.status).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('allows the configured origin and all reads', async () => {
    const ok = await request(app)
      .post('/auth/login')
      .set(CLIENT)
      .set('Origin', 'http://localhost:3000')
      .send(credentials(a));
    expect(ok.status).toBe(200);
    expect((await request(app).get('/health/live')).status).toBe(200);
  });

  it('applies to GraphQL mutations too', async () => {
    const res = await request(app).post('/graphql').send({ query: ME });
    expect(res.status).toBe(403);
  });
});

describe('me', () => {
  it('returns the signed-in user', async () => {
    const { agent } = await signIn(app, a);
    const res = await agent.post('/graphql').set(CLIENT).send({ query: ME });
    expect(res.body.errors).toBeUndefined();
    expect(res.body.data.me).toMatchObject({
      user: { id: a.ownerId },
      organisation: { id: a.tenantId },
      permissions: ['*'],
    });
  });

  it('is UNAUTHENTICATED without a session', async () => {
    const res = await gql(app, ME);
    expect(res.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
    expect(res.body.data).toBeNull();
  });

  it('never returns another tenant’s data', async () => {
    const { agent } = await signIn(app, b);
    const res = await agent.post('/graphql').set(CLIENT).send({ query: ME });
    expect(res.body.data.me.organisation.id).toBe(b.tenantId);
    expect(JSON.stringify(res.body)).not.toContain(a.tenantId);
  });

  it.each([
    ['garbage', async () => 'not.a.jwt'],
    [
      'signed with another secret',
      async () =>
        createTokenService('another-secret-another-secret-another-0').signAccessToken({
          userId: a.ownerId,
          tenantId: a.tenantId,
          sessionId: a.tenantId,
        }),
    ],
    [
      'alg none',
      async () => {
        const part = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
        const exp = Math.floor(Date.now() / 1000) + 600;
        return `${part({ alg: 'none', typ: 'JWT' })}.${part({ sub: a.ownerId, tid: a.tenantId, sid: a.tenantId, iss: 'erp-api', aud: 'erp-web', exp })}.`;
      },
    ],
    [
      'expired',
      async () =>
        tokens.signAccessToken(
          { userId: a.ownerId, tenantId: a.tenantId, sessionId: a.tenantId },
          -60,
        ),
    ],
    [
      'valid signature but no live session',
      async () =>
        tokens.signAccessToken({ userId: a.ownerId, tenantId: a.tenantId, sessionId: a.tenantId }),
    ],
    [
      'a user id from another tenant',
      async () => {
        const res = await login(app, credentials(a));
        const sessionId = (await tokens.verifyAccessToken(cookieValue(res, 'erp_at')!))!.sessionId;
        return tokens.signAccessToken({ userId: b.ownerId, tenantId: a.tenantId, sessionId });
      },
    ],
  ])('rejects an access token that is %s', async (_label, build) => {
    const res = await me(await build());
    expect(res.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
  });

  it('stops working the moment the user is deactivated', async () => {
    const org = await registerOrg(app);
    const { agent } = await signIn(app, org);
    await db.update(users).set({ status: 'inactive' }).where(eq(users.id, org.ownerId));

    const res = await agent.post('/graphql').set(CLIENT).send({ query: ME });
    expect(res.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
    expect((await agent.post('/auth/refresh').set(CLIENT)).status).toBe(401);
  });
});

describe('POST /auth/refresh', () => {
  const refreshWith = (target: TestApp, token: string | undefined) => {
    const req = request(target).post('/auth/refresh').set(CLIENT);
    return token === undefined ? req : req.set('Cookie', `erp_rt=${token}`);
  };

  it('rotates both tokens and keeps the session working', async () => {
    const first = await login(app, credentials(a));
    const res = await refreshWith(app, cookieValue(first, 'erp_rt'));
    expect(res.status).toBe(200);
    expect(cookieValue(res, 'erp_rt')).not.toBe(cookieValue(first, 'erp_rt'));
    expect((await me(cookieValue(res, 'erp_at')!)).body.data.me.user.id).toBe(a.ownerId);
  });

  it('revokes the whole session when a spent token comes back', async () => {
    const strict = testApp({ refreshGraceMs: 0 });
    const first = await login(strict, credentials(a));
    const stolen = cookieValue(first, 'erp_rt')!;
    const second = await refreshWith(strict, stolen);
    expect(second.status).toBe(200);

    const replay = await refreshWith(strict, stolen);
    expect(replay.status).toBe(401);
    expect(cookie(replay, 'erp_rt')).toMatch(/erp_rt=;/);

    // The legitimate holder of the newest token is signed out as well.
    expect((await refreshWith(strict, cookieValue(second, 'erp_rt'))).status).toBe(401);
    const stillIn = await me(cookieValue(second, 'erp_at')!);
    expect(stillIn.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
  });

  it('lets exactly one of two simultaneous refreshes win and keeps the session', async () => {
    const first = await login(app, credentials(a));
    const token = cookieValue(first, 'erp_rt');
    const results = await Promise.all([refreshWith(app, token), refreshWith(app, token)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);

    const winner = results.find((r) => r.status === 200)!;
    expect((await refreshWith(app, cookieValue(winner, 'erp_rt'))).status).toBe(200);
  });

  it.each([
    ['no cookie', undefined],
    ['garbage', 'garbage'],
    ['well-formed but unknown', `00000000-0000-4000-8000-000000000000.${'A'.repeat(43)}`],
    ['SQL in the tenant part', `' or 1=1 --.${'A'.repeat(43)}`],
  ])('rejects %s and clears the cookies', async (_label, token) => {
    const res = await refreshWith(app, token);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(cookie(res, 'erp_at')).toMatch(/erp_at=;/);
  });

  it('cannot use one tenant’s refresh token under another tenant’s id', async () => {
    const first = await login(app, credentials(a));
    const secret = cookieValue(first, 'erp_rt')!.split('.')[1];
    expect((await refreshWith(app, `${b.tenantId}.${secret}`)).status).toBe(401);
  });

  it('refuses an expired refresh token', async () => {
    const first = await login(app, credentials(a));
    const sessionId = (await tokens.verifyAccessToken(cookieValue(first, 'erp_at')!))!.sessionId;
    await db
      .update(refreshTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(refreshTokens.familyId, sessionId));
    expect((await refreshWith(app, cookieValue(first, 'erp_rt'))).status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('ends the session everywhere it is used', async () => {
    const { agent, res: first } = await signIn(app, a);
    const out = await agent.post('/auth/logout').set(CLIENT);
    expect(out.status).toBe(204);
    expect(cookie(out, 'erp_session')).toMatch(/erp_session=;/);

    // Copies of the old tokens are dead too.
    const old = await me(cookieValue(first, 'erp_at')!);
    expect(old.body.errors[0].extensions.code).toBe('UNAUTHENTICATED');
    const again = await request(app)
      .post('/auth/refresh')
      .set(CLIENT)
      .set('Cookie', `erp_rt=${cookieValue(first, 'erp_rt')}`);
    expect(again.status).toBe(401);
  });

  it('leaves other sessions of the same user alone', async () => {
    const one = await signIn(app, a);
    const two = await signIn(app, a);
    await one.agent.post('/auth/logout').set(CLIENT);
    const res = await two.agent.post('/graphql').set(CLIENT).send({ query: ME });
    expect(res.body.data.me.user.id).toBe(a.ownerId);
  });

  it('succeeds with no session at all', async () => {
    expect((await request(app).post('/auth/logout').set(CLIENT)).status).toBe(204);
  });
});

describe('lockout and rate limits', () => {
  it('locks an account after repeated failures, even for the right password', async () => {
    const limited = testApp({ limits: { loginFailures: { limit: 3, windowMs: 60_000 } } });
    const org = await registerOrg(limited);
    for (let i = 0; i < 3; i++) {
      expect((await login(limited, credentials(org, { password: 'wrong-password' }))).status).toBe(
        401,
      );
    }
    const locked = await login(limited, credentials(org));
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('RATE_LIMITED');
    expect(locked.body.error.message).toMatch(/Try again in 1 minute/);

    // Other accounts are unaffected.
    expect((await login(limited, credentials(a))).status).toBe(200);
  });

  it('locks unknown accounts the same way, so the lock reveals nothing', async () => {
    const limited = testApp({ limits: { loginFailures: { limit: 2, windowMs: 60_000 } } });
    const ghost = {
      organisation: 'ghost-org',
      email: 'ghost@nowhere.example',
      password: 'whatever-it-is',
    };
    expect((await login(limited, ghost)).status).toBe(401);
    expect((await login(limited, ghost)).status).toBe(401);
    expect((await login(limited, ghost)).status).toBe(429);
  });

  it('clears the failure count after a successful sign-in', async () => {
    const limited = testApp({ limits: { loginFailures: { limit: 3, windowMs: 60_000 } } });
    const org = await registerOrg(limited);
    for (let round = 0; round < 3; round++) {
      await login(limited, credentials(org, { password: 'wrong-password' }));
      await login(limited, credentials(org, { password: 'wrong-password' }));
      expect((await login(limited, credentials(org))).status).toBe(200);
    }
  });

  it('caps sign-in attempts per IP', async () => {
    const limited = testApp({ limits: { loginPerIp: { limit: 2, windowMs: 60_000 } } });
    expect((await login(limited, credentials(a))).status).toBe(200);
    expect((await login(limited, credentials(b))).status).toBe(200);
    expect((await login(limited, credentials(a))).status).toBe(429);
  });

  it('caps new organisations per IP', async () => {
    const limited = testApp({ limits: { registerPerIp: { limit: 2, windowMs: 60_000 } } });
    await registerOrg(limited);
    await registerOrg(limited);
    await expect(registerOrg(limited)).rejects.toThrow(/RATE_LIMITED/);
  });

  it('caps all requests per IP and says when to retry', async () => {
    const limited = testApp({ limits: { global: { limit: 2, windowMs: 60_000 } } });
    await gql(limited, '{ health { status } }');
    await gql(limited, '{ health { status } }');
    const res = await gql(limited, '{ health { status } }');
    expect(res.status).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect((await request(limited).get('/health/live')).status).toBe(200);
  });
});
