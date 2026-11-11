import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Env } from '../config/env';
import type { Logger } from '../core/logger';
import { runMigrations } from './migrate';
import { seedDemo } from './seed';

/** Finds the drizzle folder whether the API starts from apps/api, the repo root or a container. */
export function findMigrationsFolder(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): string {
  const candidates = [
    env.MIGRATIONS_DIR,
    path.resolve(cwd, 'drizzle'),
    path.resolve(cwd, 'apps/api/drizzle'),
    path.resolve(cwd, '../drizzle'),
  ].filter((c): c is string => Boolean(c));
  const found = candidates.find((c) => existsSync(path.join(c, 'meta', '_journal.json')));
  if (!found) throw new Error(`Migrations folder not found. Looked in: ${candidates.join(', ')}`);
  return found;
}

/**
 * Optional start-up work for hosts where the database is only reachable from
 * inside the platform (Railway's private network): apply migrations, add demo
 * data. Throws on failure so a broken migration fails the deploy instead of
 * serving an API with the wrong schema.
 */
export async function prepareDatabase(env: Env, logger: Logger): Promise<void> {
  if (env.RUN_MIGRATIONS === 'true') {
    const url = env.MIGRATION_DATABASE_URL || env.DATABASE_URL;
    logger.info('applying database migrations');
    await runMigrations(url, findMigrationsFolder());
    logger.info('database migrations applied');
  }
  if (env.SEED_DEMO === 'true') {
    if (env.NODE_ENV === 'production') {
      logger.warn('SEED_DEMO is on in production: the demo accounts use a public password');
    }
    const result = await seedDemo(env.DATABASE_URL);
    logger.info({ result }, 'demo organisation checked');
  }
}
