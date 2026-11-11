import { z } from 'zod';

const DEV_DEFAULTS = {
  DATABASE_URL: 'postgres://erp:erp_local_only@localhost:5432/erp',
  MONGO_URL: 'mongodb://localhost:27017/erp',
  REDIS_URL: 'redis://localhost:6379',
} as const;

const url = (protocols: string[]) =>
  z.string().refine(
    (value) => {
      try {
        return protocols.includes(new URL(value).protocol);
      } catch {
        return false;
      }
    },
    { message: `Must be a URL starting with ${protocols.join(' or ')}` },
  );

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(z.array(url(['http:', 'https:'])).min(1)),
  DATABASE_URL: url(['postgres:', 'postgresql:']).optional(),
  MONGO_URL: url(['mongodb:', 'mongodb+srv:']).optional(),
  REDIS_URL: url(['redis:', 'rediss:']).optional(),
  INSTANCE_ID: z.string().max(64).optional(),
});

export type Env = Omit<z.infer<typeof schema>, 'DATABASE_URL' | 'MONGO_URL' | 'REDIS_URL'> & {
  DATABASE_URL: string;
  MONGO_URL: string;
  REDIS_URL: string;
};

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment:\n  - ${problems.join('\n  - ')}`);
    this.name = 'EnvError';
  }
}

/**
 * Validates the environment once at boot. In production every connection
 * string must be set explicitly; local defaults are never used there.
 */
export function loadEnv(source: Record<string, string | undefined>): Env {
  // Treat empty strings as unset so `FOO=` in a .env file falls back to the default.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    throw new EnvError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }

  const env = parsed.data;
  const required = ['DATABASE_URL', 'MONGO_URL', 'REDIS_URL'] as const;
  if (env.NODE_ENV === 'production') {
    const missing = required.filter((key) => !env[key]);
    if (missing.length > 0) {
      throw new EnvError(missing.map((key) => `${key}: required in production`));
    }
  }

  return {
    ...env,
    DATABASE_URL: env.DATABASE_URL ?? DEV_DEFAULTS.DATABASE_URL,
    MONGO_URL: env.MONGO_URL ?? DEV_DEFAULTS.MONGO_URL,
    REDIS_URL: env.REDIS_URL ?? DEV_DEFAULTS.REDIS_URL,
  };
}
