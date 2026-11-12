import { ErrorCode, isErrorCode, type ApiErrorBody, type FieldErrors } from '@erp/shared';

/** What the UI should do about a failed API call. */
export type ApiErrorAction =
  | { kind: 'fields'; fieldErrors: FieldErrors; message: string; requestId?: string }
  | { kind: 'login'; message: string; requestId?: string }
  | { kind: 'forbidden'; message: string; requestId?: string }
  | { kind: 'toast'; message: string; retryable: boolean; requestId?: string };

const FALLBACK = 'Something went wrong. Please try again.';
const OFFLINE = 'Cannot reach the server. Check your connection and try again.';

function asBody(value: unknown): Partial<ApiErrorBody> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;

  // REST: { error: { code, message, ... } }
  if (record.error && typeof record.error === 'object') return asBody(record.error);

  // graphql-request ClientError: { response: { errors: [...] } }
  const response = record.response as { errors?: unknown } | undefined;
  const errors = (response?.errors ?? record.errors) as unknown;
  if (Array.isArray(errors) && errors.length > 0) {
    const first = errors[0] as { message?: unknown; extensions?: Record<string, unknown> };
    return { ...first.extensions, message: first.message as string } as Partial<ApiErrorBody>;
  }

  return 'code' in record ? (record as Partial<ApiErrorBody>) : undefined;
}

function isFieldErrors(value: unknown): value is FieldErrors {
  return (
    !!value &&
    typeof value === 'object' &&
    Object.values(value).every((v) => Array.isArray(v) && v.every((m) => typeof m === 'string'))
  );
}

/**
 * The one mapping from an API failure to a UI action. Screens call this
 * (through handleApiError) instead of inspecting errors themselves.
 * Never throws: anything unrecognised becomes a generic, retryable toast.
 */
export function resolveApiError(error: unknown): ApiErrorAction {
  if (error instanceof TypeError || (error instanceof Error && error.name === 'AbortError')) {
    return { kind: 'toast', message: OFFLINE, retryable: true };
  }

  const body = asBody(error);
  const code = isErrorCode(body?.code) ? body.code : ErrorCode.INTERNAL_ERROR;
  const requestId = typeof body?.requestId === 'string' ? body.requestId : undefined;
  const serverMessage = typeof body?.message === 'string' && body.message ? body.message : FALLBACK;

  switch (code) {
    // A conflict or rule that names the field ("email already used") belongs next to that input.
    case ErrorCode.CONFLICT:
    case ErrorCode.BUSINESS_RULE:
    case ErrorCode.VALIDATION_ERROR:
      return isFieldErrors(body?.fieldErrors) && Object.keys(body.fieldErrors).length > 0
        ? { kind: 'fields', fieldErrors: body.fieldErrors, message: serverMessage, requestId }
        : { kind: 'toast', message: serverMessage, retryable: false, requestId };
    case ErrorCode.UNAUTHENTICATED:
      return { kind: 'login', message: serverMessage, requestId };
    case ErrorCode.FORBIDDEN:
      return { kind: 'forbidden', message: serverMessage, requestId };
    case ErrorCode.RATE_LIMITED:
      return { kind: 'toast', message: serverMessage, retryable: true, requestId };
    case ErrorCode.INTERNAL_ERROR:
      // Never show whatever text came with an unknown failure.
      return { kind: 'toast', message: FALLBACK, retryable: true, requestId };
    default:
      return { kind: 'toast', message: serverMessage, retryable: false, requestId };
  }
}
