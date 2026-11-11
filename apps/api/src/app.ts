import { useDisableIntrospection } from '@graphql-yoga/plugin-disable-introspection';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import type { GraphQLSchema } from 'graphql';
import { createYoga } from 'graphql-yoga';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Env } from './config/env';
import { createCookieWriter } from './core/auth/cookies';
import { CLIENT_HEADER, authenticate, csrfGuard } from './core/auth/middleware';
import { createMaskError, errorHandler, notFoundHandler, useUniformErrors } from './core/errors';
import { requestId } from './core/http/request-id';
import type { Logger } from './core/logger';
import { DEFAULT_LIMITS, globalRateLimit, type Limits, type RateLimiter } from './core/rate-limit';
import { getContext, getRequestId } from './core/request-context';
import type { DatabaseHandle } from './db/client';
import { buildSchema, type GraphQLContext } from './graphql/schema';
import { authRouter } from './modules/auth/routes';
import { createServices } from './services';

export interface ReadinessCheck {
  name: string;
  check: () => Promise<void>;
  /** A failing non-critical dependency is reported but does not take the instance out of rotation. */
  critical?: boolean;
}

const READINESS_TIMEOUT_MS = 2000;

/** A hung dependency must not hang the probe: the balancer needs a fast answer. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export interface AppDeps {
  env: Env;
  logger: Logger;
  database: DatabaseHandle;
  /** Redis-backed in production; in-memory in tests. */
  limiter: RateLimiter;
  limits?: Partial<Limits>;
  refreshGraceMs?: number;
  /** Overridable so tests can mount resolvers that fail on purpose. */
  schema?: GraphQLSchema;
  /** Defaults to a PostgreSQL ping. */
  readinessChecks?: ReadinessCheck[];
}

export function createApp({
  env,
  logger,
  database,
  limiter,
  limits: limitOverrides,
  refreshGraceMs,
  schema,
  readinessChecks = [{ name: 'postgres', check: database.ping }],
}: AppDeps): Express {
  const isProd = env.NODE_ENV === 'production';
  const limits: Limits = { ...DEFAULT_LIMITS, ...limitOverrides };
  const services = createServices({
    env,
    db: database.db,
    logger,
    limiter,
    limits,
    refreshGraceMs,
  });
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // exactly one proxy hop: the load balancer

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: () => getRequestId(),
      autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
    }),
  );
  app.use(helmet({ contentSecurityPolicy: isProd ? undefined : false }));
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  app.use(globalRateLimit(limiter, limits.global));

  app.get('/health/live', (_req, res) => {
    res.json({ status: 'ok', instance: env.INSTANCE_ID ?? null });
  });

  app.get('/health/ready', async (_req, res) => {
    const results = await Promise.all(
      readinessChecks.map(async ({ name, check, critical = true }) => {
        try {
          await withTimeout(check(), READINESS_TIMEOUT_MS);
          return { name, ok: true, critical };
        } catch (error) {
          logger.warn({ err: error, dependency: name }, 'readiness check failed');
          return { name, ok: false, critical };
        }
      }),
    );
    const ready = results.every((result) => result.ok || !result.critical);
    res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable', checks: results });
  });

  app.use(cookieParser());
  app.use(csrfGuard(env.CORS_ORIGINS));
  app.use(authenticate(services.tokens));

  app.use('/auth', authRouter(services.auth, createCookieWriter(isProd)));

  const yoga = createYoga<object, GraphQLContext>({
    schema: schema ?? buildSchema(env, services),
    graphqlEndpoint: '/graphql',
    landingPage: false,
    // GraphiQL sends the client header so it passes the CSRF guard in development.
    graphiql: isProd ? false : { headers: JSON.stringify({ [CLIENT_HEADER]: 'graphiql' }) },
    logging: false,
    maskedErrors: { maskError: createMaskError(logger) },
    context: () => {
      const request = getContext();
      const auth = request?.auth ?? null;
      let viewer: ReturnType<GraphQLContext['viewer']> | undefined;
      return {
        requestId: getRequestId(),
        ip: request?.ip ?? 'unknown',
        auth,
        viewer: () => (viewer ??= services.auth.getViewer(auth)),
      };
    },
    plugins: [useUniformErrors(), ...(isProd ? [useDisableIntrospection()] : [])],
  });
  app.use(yoga.graphqlEndpoint, yoga);

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
