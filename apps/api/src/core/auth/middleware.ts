import type { RequestHandler } from 'express';
import { ForbiddenError } from '../errors/app-error';
import { getContext } from '../request-context';
import { ACCESS_COOKIE } from './cookies';
import type { TokenService } from './tokens';

/**
 * Reads the access-token cookie. A missing, expired or forged token simply
 * leaves the request anonymous; operations that need a user reject it later.
 */
export function authenticate(tokens: TokenService): RequestHandler {
  return (req, _res, next) => {
    const token: unknown = req.cookies?.[ACCESS_COOKIE];
    if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return next();
    tokens
      .verifyAccessToken(token)
      .then((auth) => {
        const context = getContext();
        if (context && auth) context.auth = auth;
        next();
      })
      .catch(next);
  };
}

export const CLIENT_HEADER = 'x-erp-client';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF guard for cookie-authenticated writes.
 *  - A custom header cannot be added by a plain HTML form, and from script it
 *    forces a CORS preflight that only allowed origins pass.
 *  - If the browser sent an Origin, it must be one we serve.
 * SameSite=Lax cookies are the first layer; this is the second.
 */
export function csrfGuard(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (origin && !allowed.has(origin)) return next(new ForbiddenError('Request blocked'));
    if (!req.get(CLIENT_HEADER)) return next(new ForbiddenError('Request blocked'));
    next();
  };
}
