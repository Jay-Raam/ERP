import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export function createDatabase(url: string, options: { max?: number } = {}) {
  const client = postgres(url, {
    max: options.max ?? 10,
    idle_timeout: 30,
    connect_timeout: 10,
    // Notices (e.g. "role already exists, skipping") are not errors; keep them out of stdout.
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });

  return {
    db,
    /** Readiness probe. */
    ping: async () => {
      await client`select 1`;
    },
    close: () => client.end({ timeout: 5 }),
  };
}

export type DatabaseHandle = ReturnType<typeof createDatabase>;
export type Database = DatabaseHandle['db'];
/** A transaction that already has its tenant and role set. Repositories accept only this. */
export type TenantTx = Parameters<Parameters<Database['transaction']>[0]>[0];
