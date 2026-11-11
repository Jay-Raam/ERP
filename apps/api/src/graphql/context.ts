import type { Viewer } from '@erp/shared';
import type { AuthContext } from '../core/request-context';

export interface GraphQLContext {
  requestId: string;
  ip: string;
  /** Identity from the access token, or null when anonymous. */
  auth: AuthContext | null;
  /**
   * The signed-in user with role and permissions. Loaded once per request and
   * rejects with UNAUTHENTICATED when there is no valid session. Every
   * protected resolver starts by awaiting this.
   */
  viewer: () => Promise<Viewer>;
}
