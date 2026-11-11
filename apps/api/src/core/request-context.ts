import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request state that follows the async call chain.
 */
export interface AuthContext {
  userId: string;
  tenantId: string;
  /** The refresh-token family this access token belongs to. */
  sessionId: string;
}

export interface RequestContext {
  requestId: string;
  ip: string;
  userAgent: string | null;
  /** Set by the authenticate middleware when the access token is valid. */
  auth: AuthContext | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getRequestId(): string {
  return storage.getStore()?.requestId ?? 'unknown';
}
