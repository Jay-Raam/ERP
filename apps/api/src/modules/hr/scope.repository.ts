import { eq, inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { Scope } from './scope';

/** The row filter for a scope, or undefined when no filter is needed. */
export function scopeCondition(
  scope: Scope,
  columns: { branchId: AnyColumn; userId: AnyColumn },
): SQL | undefined {
  switch (scope.kind) {
    case 'organisation':
      return undefined;
    case 'branch':
      return scope.branchIds.length > 0 ? inArray(columns.branchId, scope.branchIds) : sql`false`;
    case 'own':
      return eq(columns.userId, scope.userId);
  }
}
