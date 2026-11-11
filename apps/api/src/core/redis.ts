import { Redis } from 'ioredis';
import type { Logger } from './logger';

/**
 * Commands fail fast when Redis is unreachable (no offline queue), so callers
 * can fall back instead of hanging a request.
 */
export function createRedis(url: string, logger: Logger) {
  const client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    retryStrategy: (attempt) => Math.min(attempt * 500, 10_000),
  });

  let lastLogged = 0;
  client.on('error', (error: Error) => {
    // ioredis emits an error on every reconnect attempt; log at most twice a minute.
    if (Date.now() - lastLogged < 30_000) return;
    lastLogged = Date.now();
    logger.warn({ err: { message: error.message } }, 'redis connection error');
  });
  client.connect().catch(() => {
    // Reported through the error event; the retry strategy keeps trying.
  });

  return {
    client,
    ping: async () => {
      await client.ping();
    },
    close: async () => {
      try {
        await client.quit();
      } catch {
        client.disconnect();
      }
    },
  };
}

export type RedisHandle = ReturnType<typeof createRedis>;
