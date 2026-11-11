import express, { Router } from 'express';
import { REFRESH_COOKIE, type CookieWriter } from '../../core/auth/cookies';
import { AuthenticationError } from '../../core/errors';
import { getContext } from '../../core/request-context';
import type { AuthService, RequestMeta } from './service';

function requestMeta(): RequestMeta {
  const context = getContext();
  return { ip: context?.ip ?? 'unknown', userAgent: context?.userAgent ?? null };
}

/** REST endpoints that set or clear cookies. Everything else goes through GraphQL. */
export function authRouter(service: AuthService, cookies: CookieWriter): Router {
  const router = Router();

  router.use(express.json({ limit: '10kb', strict: true }));
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.post('/login', async (req, res) => {
    const { viewer, tokens } = await service.login(req.body, requestMeta());
    cookies.setSession(res, tokens);
    // Tokens travel only in httpOnly cookies, never in the body.
    res.json({ viewer });
  });

  router.post('/refresh', async (req, res) => {
    try {
      const tokens = await service.refresh(req.cookies?.[REFRESH_COOKIE], requestMeta());
      cookies.setSession(res, tokens);
      res.json({ ok: true });
    } catch (error) {
      if (error instanceof AuthenticationError) cookies.clearSession(res);
      throw error;
    }
  });

  router.post('/logout', async (req, res) => {
    await service.logout(req.cookies?.[REFRESH_COOKIE]);
    cookies.clearSession(res);
    res.status(204).end();
  });

  return router;
}
