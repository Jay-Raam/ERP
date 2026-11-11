import { hasPermission, type Viewer } from '@erp/shared';
import { ForbiddenError } from '../errors/app-error';

/**
 * The one permission check every protected service method starts with.
 * Hiding a menu item in the UI is a convenience; this is the control.
 */
export function requirePermission(viewer: Viewer, key: string): void {
  if (!hasPermission(viewer.permissions, key)) {
    throw new ForbiddenError();
  }
}
