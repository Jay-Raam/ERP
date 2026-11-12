import type { Viewer } from '@erp/shared';
import { ForbiddenError } from '../../core/errors';

/**
 * Which records a viewer may reach. Permissions say what a person may do; the
 * scope says which records they may do it to. Pure data: repositories turn it into SQL.
 *  - organisation: every row
 *  - branch: rows in the branches the viewer works in
 *  - own: only the viewer's own employee record
 */
export type Scope =
  | { kind: 'organisation' }
  | { kind: 'branch'; branchIds: string[] }
  | { kind: 'own'; userId: string };

export function scopeOf(viewer: Viewer): Scope {
  switch (viewer.role.dataScope) {
    case 'organisation':
      return { kind: 'organisation' };
    case 'branch':
      return { kind: 'branch', branchIds: viewer.branches.map((b) => b.id) };
    case 'own':
      return { kind: 'own', userId: viewer.user.id };
  }
}

/** "-own" permissions apply to the caller only, whatever the role's data scope says. */
export const selfScope = (viewer: Viewer): Scope => ({ kind: 'own', userId: viewer.user.id });

/** True when a record in this branch, owned by this user, is inside the viewer's scope. */
export function inScope(
  viewer: Viewer,
  record: { branchId: string; userId: string | null },
): boolean {
  switch (viewer.role.dataScope) {
    case 'organisation':
      return true;
    case 'branch':
      return viewer.branches.some((b) => b.id === record.branchId);
    case 'own':
      return record.userId !== null && record.userId === viewer.user.id;
  }
}

/** For creating or moving records into a branch: own-scope roles cannot, branch-scope stay in their branches. */
export function assertBranchInScope(viewer: Viewer, branchId: string): void {
  if (viewer.role.dataScope === 'organisation') return;
  if (viewer.role.dataScope === 'branch' && viewer.branches.some((b) => b.id === branchId)) return;
  throw new ForbiddenError('That branch is outside your access');
}
