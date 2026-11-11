import path from 'node:path';
import postgres from 'postgres';
import { runMigrations } from '../../src/db/migrate';
import { TEST_DATABASE_URL, assertTestDatabase } from './test-db';

/** Runs once before all test files: wipe the test database and migrate it from zero. */
export default async function setup(): Promise<void> {
  assertTestDatabase(TEST_DATABASE_URL);

  await ensureDatabaseExists();

  const sql = postgres(TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    await sql`DROP SCHEMA IF EXISTS public CASCADE`;
    await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;
    await sql`CREATE SCHEMA public`;
  } finally {
    await sql.end({ timeout: 5 });
  }

  await runMigrations(TEST_DATABASE_URL, path.resolve(import.meta.dirname, '../../drizzle'));
}

/** Creates the *_test database on first run, so no manual step is needed. */
async function ensureDatabaseExists(): Promise<void> {
  const target = new URL(TEST_DATABASE_URL);
  const name = target.pathname.slice(1);
  const maintenance = new URL(TEST_DATABASE_URL);
  maintenance.pathname = '/postgres';

  const sql = postgres(maintenance.toString(), { max: 1, onnotice: () => {} });
  try {
    const found = await sql`select 1 from pg_database where datname = ${name}`;
    // The name passed assertTestDatabase and is quoted as an identifier.
    if (found.length === 0) await sql`create database ${sql(name)}`;
  } catch (error) {
    throw new Error(
      `Cannot reach PostgreSQL for tests at ${target.host}. Start it with "pnpm infra:up", or set TEST_DATABASE_URL. (${(error as Error).message})`,
      { cause: error },
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
