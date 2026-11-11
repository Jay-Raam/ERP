import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findMigrationsFolder } from '../src/db/boot';

const apiDir = path.resolve(import.meta.dirname, '..');

describe('findMigrationsFolder', () => {
  it('finds the folder from apps/api, from the repo root, and via MIGRATIONS_DIR', () => {
    const expected = path.join(apiDir, 'drizzle');
    expect(findMigrationsFolder({}, apiDir)).toBe(expected);
    expect(findMigrationsFolder({}, path.resolve(apiDir, '../..'))).toBe(expected);
    expect(findMigrationsFolder({ MIGRATIONS_DIR: expected }, '/nowhere')).toBe(expected);
  });

  it('fails with a clear message when it cannot find the folder', () => {
    expect(() => findMigrationsFolder({}, '/nowhere')).toThrow(/Migrations folder not found/);
  });
});
