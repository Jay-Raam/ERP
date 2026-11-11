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
      // The ORM wraps the real failure; walk down to it. Messages only: the URL holds a password.
      const messages: string[] = [];
      let current: unknown = error;
      for (let depth = 0; current instanceof Error && depth < 5; depth++) {
        const code = (current as { code?: unknown }).code;
        messages.push(typeof code === 'string' ? `${current.message} [${code}]` : current.message);
        current = current.cause;
      }
      process.stderr.write(`migration failed: ${messages.join('\n  caused by: ')}\n`);

      const root = messages.at(-1) ?? '';
      const host = new URL(url).hostname;
      if (/ENOTFOUND|EAI_AGAIN/.test(root)) {
        process.stderr.write(
          `\nCannot find the database host "${host}". If this is a private hostname (for example *.railway.internal), use the provider's public connection URL when running from your own computer.\n`,
        );
      } else if (/ECONNREFUSED|ETIMEDOUT|CONNECT_TIMEOUT/.test(root)) {
        process.stderr.write(
          `\nCannot connect to "${host}". Check that the database is running and reachable (pnpm infra:up for the local one).\n`,
        );
      } else if (/28P01|28000|password authentication/.test(root)) {
        process.stderr.write(
          '\nThe database rejected the username or password in the connection URL.\n',
        );
      }
      process.exit(1);
    });
}
