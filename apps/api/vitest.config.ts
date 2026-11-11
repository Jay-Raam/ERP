import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['tests/support/global-setup.ts'],
    testTimeout: 15_000,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts', 'src/db/migrate.ts', 'src/**/*.test.ts'],
      reporter: ['text-summary', 'json-summary', 'html'],
    },
  },
});
