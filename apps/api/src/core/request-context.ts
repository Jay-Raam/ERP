import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request state that follows the async call chain.
 * Tenant, user and permission context are added here when auth lands.
 */
export interface RequestContext {
  requestId: string;
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
