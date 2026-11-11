import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/** Applies pending migrations. Uses one dedicated connection and closes it. */
export async function runMigrations(url: string, migrationsFolder: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end({ timeout: 5 });
  }
}

// CLI: pnpm db:migrate
if (process.argv[1] && /migrate\.(ts|cjs|js)$/.test(process.argv[1])) {
  // Migrations need an owner-level login; the API itself can run with a restricted one.
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    process.stderr.write('Set MIGRATION_DATABASE_URL or DATABASE_URL\n');
    process.exit(1);
  }
  const folder = process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), 'drizzle');
  runMigrations(url, folder)
    .then(() => process.stdout.write('migrations applied\n'))
    .catch((error: unknown) => {
      // Print the message only: connection errors can carry the URL.
      process.stderr.write(
        `migration failed: ${error instanceof Error ? error.message : 'unknown error'}\n`,
      );
      process.exit(1);
    });
}
