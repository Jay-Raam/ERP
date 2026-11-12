import { createHash, randomUUID } from 'node:crypto';
import { loginInputSchema, type Viewer } from '@erp/shared';
import {
  REFRESH_TOKEN_TTL_MS,
  generateRefreshToken,
  hashRefreshToken,
  parseRefreshToken,
  type TokenService,
} from '../../core/auth/tokens';
import { AuthenticationError, RateLimitedError } from '../../core/errors';
import type { Logger } from '../../core/logger';
import { hashPassword, verifyPassword } from '../../core/password';
import { enforceLimit, retryMessage, type Limits, type RateLimiter } from '../../core/rate-limit';
import type { AuthContext } from '../../core/request-context';
import type { Database, TenantTx } from '../../db/client';
import { findTenantByEmail, withTenant } from '../../db/tenant';
import * as repo from './repository';

export interface RequestMeta {
  ip: string;
  userAgent: string | null;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

interface AuthServiceDeps {
  db: Database;
  logger: Logger;
  tokens: TokenService;
  limiter: RateLimiter;
  limits: Limits;
  /**
   * Two tabs can present the same refresh token at the same moment. Within
   * this window the loser is refused but the session is kept; after it, a
   * spent token coming back is treated as theft.
   */
  refreshGraceMs?: number;
}

// One message for every sign-in failure, so the response never reveals whether
// the email exists or the password was wrong.
const BAD_CREDENTIALS = 'Email or password is incorrect';
const SESSION_ENDED = 'Your session has ended. Please sign in again.';

export function createAuthService({
  db,
  logger,
  tokens,
  limiter,
  limits,
  refreshGraceMs = 3_000,
}: AuthServiceDeps) {
  // Verified against when the account does not exist, so "no such user" costs
  // the same time as "wrong password".
  let dummyHash: Promise<string> | undefined;
  const getDummyHash = () => (dummyHash ??= hashPassword(randomUUID()));

  async function issueTokens(
    tx: TenantTx,
    auth: AuthContext,
    meta: RequestMeta,
  ): Promise<SessionTokens> {
    const refreshToken = generateRefreshToken(auth.tenantId);
    await repo.insertRefreshToken(tx, {
      tenantId: auth.tenantId,
      userId: auth.userId,
      familyId: auth.sessionId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return { accessToken: await tokens.signAccessToken(auth), refreshToken };
  }

  return {
    async login(
      rawInput: unknown,
      meta: RequestMeta,
    ): Promise<{ viewer: Viewer; tokens: SessionTokens }> {
      const input = loginInputSchema.parse(rawInput);

      await enforceLimit(
        limiter,
        `login:ip:${meta.ip}`,
        limits.loginPerIp,
        'Too many sign-in attempts.',
      );

      // Keyed by what was typed, whether or not the account exists, so the
      // lock itself does not reveal which accounts are real.
      // Hashed so email addresses are not stored as keys in Redis.
      // Two counters: email + IP (tight, so a stranger's guesses only lock their own IP out
      // of that account) and email alone (loose, a backstop against a spread-out guessing attack).
      const account = createHash('sha256').update(input.email).digest('hex');
      const pairKey = `login:pair:${account}:${meta.ip}`;
      const accountKey = `login:acct:${account}`;
      const [pairLock, accountLock] = await Promise.all([
        limiter.peek(pairKey, limits.loginFailures),
        limiter.peek(accountKey, limits.loginFailuresPerAccount),
      ]);
      const lock = !pairLock.allowed ? pairLock : accountLock;
      if (!lock.allowed) {
        throw new RateLimitedError(
          retryMessage('Too many failed sign-in attempts.', lock.retryAfterMs),
        );
      }

      const tenantId = await findTenantByEmail(db, input.email);
      const user = tenantId
        ? await withTenant(db, tenantId, (tx) => repo.findUserForLogin(tx, input.email))
        : null;

      const passwordOk = await verifyPassword(
        input.password,
        user?.passwordHash ?? (await getDummyHash()),
      );
      const allowed =
        tenantId !== null &&
        user !== null &&
        passwordOk &&
        user.status === 'active' &&
        user.orgStatus === 'active';

      if (!allowed) {
        await Promise.all([
          limiter.hit(pairKey, limits.loginFailures),
          limiter.hit(accountKey, limits.loginFailuresPerAccount),
        ]);
        logger.info('sign-in rejected');
        throw new AuthenticationError(BAD_CREDENTIALS);
      }

      await limiter.reset(pairKey);
      const auth: AuthContext = { userId: user.id, tenantId, sessionId: randomUUID() };
      const result = await withTenant(db, tenantId, async (tx) => {
        const sessionTokens = await issueTokens(tx, auth, meta);
        const viewer = await repo.loadViewer(tx, auth.userId, auth.sessionId);
        return { tokens: sessionTokens, viewer };
      });
      // Deactivated between the check above and here.
      if (!result.viewer) throw new AuthenticationError(BAD_CREDENTIALS);

      logger.info({ tenantId, userId: user.id }, 'signed in');
      return { viewer: result.viewer, tokens: result.tokens };
    },

    /** Swaps a refresh token for a new pair. Each refresh token works once. */
    async refresh(rawToken: unknown, meta: RequestMeta): Promise<SessionTokens> {
      await enforceLimit(limiter, `refresh:ip:${meta.ip}`, limits.refreshPerIp);

      const parsed = parseRefreshToken(rawToken);
      if (!parsed) throw new AuthenticationError(SESSION_ENDED);
      const { tenantId } = parsed;
      const tokenHash = hashRefreshToken(rawToken as string);

      // Decisions that must be saved (spending the token, revoking a family)
      // are returned, not thrown: throwing would roll the transaction back.
      const outcome = await withTenant(db, tenantId, async (tx) => {
        const claimed = await repo.claimRefreshToken(tx, tokenHash);
        if (!claimed) {
          const existing = await repo.findRefreshToken(tx, tokenHash);
          const spentAgo = existing?.usedAgoMs ?? null;
          if (existing && !existing.revokedAt && spentAgo !== null && spentAgo > refreshGraceMs) {
            await repo.revokeFamily(tx, existing.familyId);
            return { kind: 'reuse' as const, familyId: existing.familyId };
          }
          return { kind: 'invalid' as const };
        }

        if (!(await repo.isUserActive(tx, claimed.userId))) {
          await repo.revokeFamily(tx, claimed.familyId);
          return { kind: 'invalid' as const };
        }

        const auth: AuthContext = { userId: claimed.userId, tenantId, sessionId: claimed.familyId };
        return { kind: 'ok' as const, tokens: await issueTokens(tx, auth, meta) };
      });

      if (outcome.kind === 'reuse') {
        logger.warn(
          { tenantId, familyId: outcome.familyId },
          'refresh token reuse: session revoked',
        );
      }
      if (outcome.kind !== 'ok') throw new AuthenticationError(SESSION_ENDED);
      return outcome.tokens;
    },

    /** Ends the session the refresh token belongs to. Safe to call with anything. */
    async logout(rawToken: unknown): Promise<void> {
      const parsed = parseRefreshToken(rawToken);
      if (!parsed) return;
      const tokenHash = hashRefreshToken(rawToken as string);
      await withTenant(db, parsed.tenantId, async (tx) => {
        const existing = await repo.findRefreshToken(tx, tokenHash);
        if (existing) await repo.revokeFamily(tx, existing.familyId);
      });
    },

    /** The current user, re-read from the database on every request. */
    async getViewer(auth: AuthContext | null): Promise<Viewer> {
      if (!auth) throw new AuthenticationError();
      const viewer = await withTenant(db, auth.tenantId, (tx) =>
        repo.loadViewer(tx, auth.userId, auth.sessionId),
      );
      if (!viewer) throw new AuthenticationError(SESSION_ENDED);
      return viewer;
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
