import type { CookieOptions, Response } from 'express';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_MS } from './tokens';

export const ACCESS_COOKIE = 'erp_at';
export const REFRESH_COOKIE = 'erp_rt';
/** Carries no secret: tells the web app's route guard that a session may exist. */
export const SESSION_HINT_COOKIE = 'erp_session';

/** The refresh token is only ever sent to the auth endpoints. */
const REFRESH_PATH = '/auth';

export function createCookieWriter(secure: boolean) {
  const base: CookieOptions = { httpOnly: true, secure, sameSite: 'lax' };

  return {
    setSession(res: Response, tokens: { accessToken: string; refreshToken: string }): void {
      res.cookie(ACCESS_COOKIE, tokens.accessToken, {
        ...base,
        path: '/',
        maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
      });
      res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
        ...base,
        path: REFRESH_PATH,
        maxAge: REFRESH_TOKEN_TTL_MS,
      });
      res.cookie(SESSION_HINT_COOKIE, '1', { ...base, path: '/', maxAge: REFRESH_TOKEN_TTL_MS });
    },

    clearSession(res: Response): void {
      res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
      res.clearCookie(REFRESH_COOKIE, { ...base, path: REFRESH_PATH });
      res.clearCookie(SESSION_HINT_COOKIE, { ...base, path: '/' });
    },
  };
}

export type CookieWriter = ReturnType<typeof createCookieWriter>;
