import { useDisableIntrospection } from '@graphql-yoga/plugin-disable-introspection';
import cors from 'cors';
import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { GraphQLSchema } from 'graphql';
import { createYoga } from 'graphql-yoga';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { Env } from './config/env';
import {
  RateLimitedError,
  createMaskError,
  errorHandler,
  notFoundHandler,
  useUniformErrors,
} from './core/errors';
import { requestId } from './core/http/request-id';
import type { Logger } from './core/logger';
import type { DatabaseHandle } from './db/client';
import { getRequestId } from './core/request-context';
import { buildSchema, type GraphQLContext } from './graphql/schema';

export interface ReadinessCheck {
  name: string;
  check: () => Promise<void>;
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
  /** Overridable so tests can mount resolvers that fail on purpose. */
  schema?: GraphQLSchema;
  /** Defaults to a PostgreSQL ping; MongoDB and Redis are added as they are wired in. */
  readinessChecks?: ReadinessCheck[];
}

export function createApp({
  env,
  logger,
  database,
  schema,
  readinessChecks = [{ name: 'postgres', check: database.ping }],
}: AppDeps): Express {
  const isProd = env.NODE_ENV === 'production';
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

  if (env.NODE_ENV !== 'test') {
    // In-memory for now; moves to a Redis store so limits hold across instances.
    app.use(
      rateLimit({
        windowMs: 60_000,
        limit: 300,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        skip: (req) => req.path.startsWith('/health'),
        handler: (_req, _res, next) => next(new RateLimitedError()),
      }),
    );
  }

  app.get('/health/live', (_req, res) => {
    res.json({ status: 'ok', instance: env.INSTANCE_ID ?? null });
  });

  app.get('/health/ready', async (_req, res) => {
    const results = await Promise.all(
      readinessChecks.map(async ({ name, check }) => {
        try {
          await withTimeout(check(), READINESS_TIMEOUT_MS);
          return { name, ok: true };
        } catch (error) {
          logger.warn({ err: error, dependency: name }, 'readiness check failed');
          return { name, ok: false };
        }
      }),
    );
    const ready = results.every((result) => result.ok);
    res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable', checks: results });
  });

  const yoga = createYoga<object, GraphQLContext>({
    schema: schema ?? buildSchema({ env, db: database.db, logger }),
    graphqlEndpoint: '/graphql',
    landingPage: false,
    graphiql: !isProd,
    logging: false,
    maskedErrors: { maskError: createMaskError(logger) },
    context: () => ({ requestId: getRequestId() }),
    plugins: [useUniformErrors(), ...(isProd ? [useDisableIntrospection()] : [])],
  });
  app.use(yoga.graphqlEndpoint, yoga);

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
