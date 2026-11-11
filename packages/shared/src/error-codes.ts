/**
 * Stable error codes shared by the API and the web app.
 * Codes are part of the public contract: add new ones, never rename.
 */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  BUSINESS_RULE: 'BUSINESS_RULE',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export type FieldErrors = Record<string, string[]>;

/** The one error shape every API failure is turned into. */
export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  fieldErrors?: FieldErrors;
  requestId: string;
}

const CODES = new Set<string>(Object.values(ErrorCode));

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && CODES.has(value);
}
