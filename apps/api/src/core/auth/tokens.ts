import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { AuthContext } from '../request-context';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const ISSUER = 'erp-api';
const AUDIENCE = 'erp-web';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createTokenService(secret: string, now: () => number = Date.now) {
  const key = new TextEncoder().encode(secret);

  return {
    signAccessToken(auth: AuthContext, ttlSeconds = ACCESS_TOKEN_TTL_SECONDS): Promise<string> {
      const issuedAt = Math.floor(now() / 1000);
      return new SignJWT({ tid: auth.tenantId, sid: auth.sessionId })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(auth.userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt(issuedAt)
        .setExpirationTime(issuedAt + ttlSeconds)
        .sign(key);
    },

    /** Returns null for anything that is not a valid, unexpired token of ours. Never throws. */
    async verifyAccessToken(token: string): Promise<AuthContext | null> {
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: ['HS256'], // pinned: rejects "none" and algorithm-confusion tokens
          issuer: ISSUER,
          audience: AUDIENCE,
        });
        const { sub, tid, sid } = payload;
        if (typeof sub !== 'string' || typeof tid !== 'string' || typeof sid !== 'string')
          return null;
        if (!UUID.test(sub) || !UUID.test(tid) || !UUID.test(sid)) return null;
        return { userId: sub, tenantId: tid, sessionId: sid };
      } catch {
        return null;
      }
    },
  };
}

export type TokenService = ReturnType<typeof createTokenService>;

/**
 * Refresh tokens are opaque: `<tenantId>.<256 random bits>`. The tenant prefix
 * is not a secret; it only tells the server which tenant to look in.
 */
export function generateRefreshToken(tenantId: string): string {
  return `${tenantId}.${randomBytes(32).toString('base64url')}`;
}

export function parseRefreshToken(token: unknown): { tenantId: string } | null {
  if (typeof token !== 'string' || token.length > 128) return null;
  const [tenantId, secret, ...rest] = token.split('.');
  if (rest.length > 0 || !tenantId || !secret) return null;
  if (!UUID.test(tenantId) || !/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  return { tenantId };
}

/** Only this hash is stored, so a database leak does not leak usable sessions. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
