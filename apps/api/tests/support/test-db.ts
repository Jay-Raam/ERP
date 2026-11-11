/** Tests never read DATABASE_URL: that may point at a real database. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://erp:erp_local_only@localhost:5432/erp_test';

export function assertTestDatabase(url: string): void {
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against database "${name}". TEST_DATABASE_URL must name a database ending in _test.`,
    );
  }
}
