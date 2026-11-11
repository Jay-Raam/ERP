import { ErrorCode, type ApiErrorBody } from '@erp/shared';

// Required by the API's CSRF guard on every write.
const HEADERS = { 'content-type': 'application/json', 'x-erp-client': 'web' };

/** A failure the API described. `error` has the standard body; pass the whole thing to handleApiError. */
export class ApiError extends Error {
  constructor(
    readonly error: Partial<ApiErrorBody>,
    readonly status: number,
  ) {
    super(error.message ?? 'Request failed');
    this.name = 'ApiError';
  }
}

async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function readJson(res: Response): Promise<unknown> {
  // A gateway error page is not JSON; treat it like the network being down.
  if (res.status >= 502) throw new TypeError('API unreachable');
  if (res.status === 204) return null;
  try {
    return await res.json();
  } catch {
    throw new TypeError('API returned a non-JSON response');
  }
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Trades the refresh cookie for a new session. Calls made at the same moment
 * share one request: the refresh token works once, so parallel refreshes
 * would sign the user out.
 */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= post('/auth/refresh')
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: { message: string; extensions?: Partial<ApiErrorBody> }[];
}

/** Runs a GraphQL operation. On UNAUTHENTICATED it refreshes the session once and retries. */
export async function gqlRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
  options: { retryOnUnauthenticated?: boolean } = {},
): Promise<T> {
  const { retryOnUnauthenticated = true } = options;
  const res = await post('/graphql', { query, variables });
  const body = (await readJson(res)) as
    GraphQLResponse<T> | { error?: Partial<ApiErrorBody> } | null;

  // Rejected before GraphQL ran (rate limit, CSRF guard): REST error shape.
  if (body && 'error' in body && body.error) throw new ApiError(body.error, res.status);

  const result = (body ?? {}) as GraphQLResponse<T>;
  const first = result.errors?.[0];
  if (first) {
    if (first.extensions?.code === ErrorCode.UNAUTHENTICATED && retryOnUnauthenticated) {
      if (await refreshSession()) {
        return gqlRequest<T>(query, variables, { retryOnUnauthenticated: false });
      }
    }
    throw new ApiError({ ...first.extensions, message: first.message }, res.status);
  }
  if (result.data === null || result.data === undefined) {
    throw new ApiError({ code: ErrorCode.INTERNAL_ERROR }, res.status);
  }
  return result.data;
}

/** POST to a REST endpoint (sign-in, sign-out). */
export async function restPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await post(path, body);
  const json = (await readJson(res)) as { error?: Partial<ApiErrorBody> } | null;
  if (!res.ok) throw new ApiError(json?.error ?? { code: ErrorCode.INTERNAL_ERROR }, res.status);
  return json as T;
}
