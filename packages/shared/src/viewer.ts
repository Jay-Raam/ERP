import type { DataScope } from './default-roles';

/** The signed-in user, as returned by POST /auth/login and the `me` query. */
export interface Viewer {
  user: { id: string; email: string; fullName: string };
  organisation: { id: string; slug: string; name: string };
  role: { key: string; name: string; dataScope: DataScope };
  /** Permission grants; check them with hasPermission(). */
  permissions: string[];
  branches: { id: string; code: string; name: string; isHeadOffice: boolean }[];
}
