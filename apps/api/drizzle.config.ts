import { defineConfig } from 'drizzle-kit';

// Used only to generate SQL from the schema (pnpm db:generate); no connection needed.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
});
