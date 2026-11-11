import pino, { type Logger } from 'pino';
import type { Env } from '../config/env';
import { getContext } from './request-context';

export type { Logger };

export function createLogger(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL' | 'INSTANCE_ID'>): Logger {
  return pino({
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    base: { service: 'erp-api', instance: env.INSTANCE_ID },
    // Every log line written during a request carries its request ID.
    mixin: () => {
      const context = getContext();
      return context ? { requestId: context.requestId } : {};
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.token',
        '*.refreshToken',
      ],
      censor: '[redacted]',
    },
  });
}
