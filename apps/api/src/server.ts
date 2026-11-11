import { createApp } from './app';
import { EnvError, loadEnv } from './config/env';
import { createLogger } from './core/logger';
import {
  createMemoryRateLimiter,
  createRedisRateLimiter,
  createResilientRateLimiter,
} from './core/rate-limit';
import { createRedis } from './core/redis';
import { createDatabase } from './db/client';

const SHUTDOWN_TIMEOUT_MS = 10_000;

function main(): void {
  let env;
  try {
    env = loadEnv(process.env);
  } catch (error) {
    // The logger needs a valid env, so this one message goes straight to stderr.
    process.stderr.write(`${error instanceof EnvError ? error.message : String(error)}\n`);
    process.exit(1);
  }

  const logger = createLogger(env);
  // Connects lazily: the API still boots if PostgreSQL is down, and /health/ready reports it.
  const database = createDatabase(env.DATABASE_URL);
  const redis = createRedis(env.REDIS_URL, logger);
  const limiter = createResilientRateLimiter(
    createRedisRateLimiter(redis.client),
    createMemoryRateLimiter(),
    logger,
  );
  const app = createApp({
    env,
    logger,
    database,
    limiter,
    readinessChecks: [
      { name: 'postgres', check: database.ping },
      // Rate limiting falls back to memory, so Redis being down does not stop the API.
      { name: 'redis', check: redis.ping, critical: false },
    ],
  });
  if (env.NODE_ENV !== 'production' && !process.env.JWT_SECRET) {
    logger.warn('JWT_SECRET is not set; using the built-in development secret');
  }
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'api listening');
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    // Stop accepting connections, let in-flight requests finish, then exit.
    server.close((error) => {
      if (error) logger.error({ err: error }, 'error while closing server');
      Promise.all([database.close(), redis.close()])
        .catch((closeError: unknown) =>
          logger.error({ err: closeError }, 'error closing connections'),
        )
        .finally(() => process.exit(error ? 1 : 0));
    });
    setTimeout(() => {
      logger.error('shutdown timed out; forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    shutdown('uncaughtException');
  });
}

main();
