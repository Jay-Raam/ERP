interface PgErrorLike {
  code?: unknown;
  constraint_name?: unknown;
  cause?: unknown;
}

/** Finds the PostgreSQL error inside whatever wrapper the ORM put around it. */
function findPgError(error: unknown): PgErrorLike | undefined {
  let current = error as PgErrorLike | undefined;
  for (let depth = 0; current && typeof current === 'object' && depth < 5; depth++) {
    if (typeof current.code === 'string' && /^[0-9A-Z]{5}$/.test(current.code)) return current;
    current = current.cause as PgErrorLike | undefined;
  }
  return undefined;
}

/** True when the error is a unique-constraint violation, optionally of one named constraint. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const pg = findPgError(error);
  if (pg?.code !== '23505') return false;
  return constraint === undefined || pg.constraint_name === constraint;
}
